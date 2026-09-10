import { BadRequestException, Injectable, InternalServerErrorException } from '@nestjs/common';
import type { User } from '@supabase/supabase-js';
import { PurchasesService } from '../../purchases/purchases.service';
import { AppsService } from '../../apps/apps.service';
import { SupabaseService } from '../../../common/supabase/supabase.service';
import { AdminAuditService } from '../audit/admin-audit.service';
import { AdminDefaultsService } from '../defaults/admin-defaults.service';
import { paginated, toRange, type PaginatedResult } from '../../../common/utils/paginate';
import type { PaginationQueryDto } from '../dto/pagination.dto';
import type {
  CreateProvisioningPurchaseDto,
  RunProvisioningDto,
  SendConfirmationDto,
} from './dto/provisioning.dto';

/** Compares Supabase project hosts so a Sanity product can be tied to a registered app. */
function sameProject(a?: string | null, b?: string | null): boolean {
  if (!a || !b) return false;
  try {
    return new URL(a).host === new URL(b).host;
  } catch {
    return false;
  }
}

@Injectable()
export class AdminProvisioningService {
  constructor(
    private readonly purchasesService: PurchasesService,
    private readonly appsService: AppsService,
    private readonly supabaseService: SupabaseService,
    private readonly auditService: AdminAuditService,
    private readonly defaultsService: AdminDefaultsService,
  ) { }

  /**
   * Catalog for the wizard. Each entry reports whether Sanity actually carries
   * the provisioning config, so an app that cannot be provisioned is visible
   * before anyone tries.
   */
  async listApps() {
    const catalog = await this.purchasesService.fetchAllPremiumApps();
    const provisioning = await this.purchasesService.fetchProvisioningAppsByIds(
      catalog.map((app) => app._id),
    );

    const registry = this.appsService.getAllApps();

    return catalog.map((app) => {
      const details = provisioning.find((entry) => entry._id === app._id);
      const config = details?.appProvisioning;
      const matchedApp = registry.find((entry) => sameProject(entry.supabaseUrl, config?.supabaseUrl));

      return {
        productId: app._id,
        title: app.title,
        price: app.price ?? 0,
        // Never expose the URL or key itself — only whether it is usable.
        provisioningReady: Boolean(
          config?.supabaseUrl && config?.supabaseAnonKey && config?.edgeFunctionName,
        ),
        appId: matchedApp?.id ?? null,
        appName: matchedApp?.name ?? null,
      };
    });
  }

  /**
   * Reports what already exists before anything is created: the billing
   * organization, its entitlements, and whether the matching product project
   * already has an organization on that email.
   */
  async preflight(email: string, productIds: string[], ownerEmail?: string) {
    const main = this.supabaseService.getServiceRoleClient();
    // The auth account is created against the owner's address, so that is the
    // one that can collide with an existing user.
    const loginEmail = ownerEmail?.trim() || email;

    const { data: organization } = await main
      .from('organizations')
      .select('id, name, email, phone')
      .eq('email', email)
      .maybeSingle();

    const { data: entitlements } = organization
      ? await main
        .from('organization_apps')
        .select('app_id, status, plan_type, expires_at')
        .eq('organization_id', organization.id)
      : { data: [] };

    const provisioningApps = await this.purchasesService.fetchProvisioningAppsByIds(productIds);
    const registry = this.appsService.getAllApps();

    const apps = await Promise.all(
      productIds.map(async (productId) => {
        const details = provisioningApps.find((entry) => entry._id === productId);
        const config = details?.appProvisioning;
        const matched = registry.find((entry) => sameProject(entry.supabaseUrl, config?.supabaseUrl));
        const entitlement = (entitlements ?? []).find((row) => row.app_id === productId);

        // Two different things can already exist in the product project: an
        // organization registered under this email, and a user account. The
        // user account is what actually collides during provisioning, and it
        // is common for the org email to differ from the owner's login.
        let existingInProductApp: { id: string; name: string | null } | null = null;
        let existingUserInProductApp: { id: string; name: string | null } | null = null;

        if (matched && this.appsService.isConfigured(matched.id)) {
          const client = this.appsService.getSupabaseClient(matched.id);
          const [org, profile] = await Promise.all([
            client.from('organizations').select('id, name').eq('email', email).maybeSingle(),
            client
              .from('profiles')
              .select('id, first_name, last_name')
              .eq('email', loginEmail)
              .maybeSingle(),
          ]);

          existingInProductApp = org.data ?? null;
          existingUserInProductApp = profile.data
            ? {
              id: profile.data.id,
              name:
                [profile.data.first_name, profile.data.last_name].filter(Boolean).join(' ') ||
                null,
            }
            : null;
        }

        return {
          productId,
          title: details?.title ?? null,
          provisioningReady: Boolean(
            config?.supabaseUrl && config?.supabaseAnonKey && config?.edgeFunctionName,
          ),
          appId: matched?.id ?? null,
          appName: matched?.name ?? null,
          entitlement: entitlement ?? null,
          existingInProductApp,
          existingUserInProductApp,
        };
      }),
    );

    return {
      organization: organization ?? null,
      apps,
    };
  }

  async createPurchase(payload: CreateProvisioningPurchaseDto, actor: User | undefined) {
    const clientReference =
      payload.clientReference?.trim() ||
      `FMT_${Date.now()}_${Math.floor(Math.random() * 1000)}`;

    const organizationId = await this.purchasesService.ensureOrganizationAndBillingAddress(
      payload.billingDetails,
      payload.isExistingOrg ?? false,
    );

    const purchase = await this.purchasesService.createPurchaseRecord({
      organizationId,
      clientReference,
      amount: payload.total,
      status: payload.status ?? 'completed',
      items: payload.items,
      paymentProvider: 'manual',
      paymentMethod: 'manual',
      externalTransactionId: clientReference,
      paymentDetails: {
        manualEntry: true,
        enteredBy: actor?.email ?? 'admin',
        note: payload.note ?? null,
      },
    });

    await this.auditService.record(actor, {
      action: 'provisioning.purchase_created',
      organizationId,
      targetId: purchase.id,
      summary: `Created a manual purchase for ${payload.billingDetails.organizationName}`,
      details: {
        clientReference,
        total: payload.total,
        productIds: payload.items.map((item) => item.productId),
        isExistingOrg: payload.isExistingOrg ?? false,
        note: payload.note ?? null,
      },
    });

    return { organizationId, purchase, clientReference };
  }

  /**
   * Provisions the selected apps. Provisioning credentials are resolved from
   * Sanity here rather than being sent by the client, so the browser never
   * handles another project's Supabase keys.
   */
  async runProvisioning(payload: RunProvisioningDto, actor: User | undefined) {
    const productIds = payload.apps.map((app) => app.productId);
    const provisioningApps = await this.purchasesService.fetchProvisioningAppsByIds(productIds);

    const missing = productIds.filter(
      (productId) => !provisioningApps.some((app) => app._id === productId),
    );
    if (missing.length) {
      throw new BadRequestException(
        `These products were not found or are unpublished in Sanity: ${missing.join(', ')}`,
      );
    }

    const notReady = provisioningApps.filter(
      (app) =>
        !app.appProvisioning?.supabaseUrl ||
        !app.appProvisioning?.supabaseAnonKey ||
        !app.appProvisioning?.edgeFunctionName,
    );
    if (notReady.length) {
      throw new BadRequestException(
        `Missing provisioning configuration in Sanity for: ${notReady.map((app) => app.title).join(', ')}`,
      );
    }

    const appProvisioningDetails = Object.fromEntries(
      provisioningApps.map((app) => {
        const selection = payload.apps.find((entry) => entry.productId === app._id);
        const config = app.appProvisioning!;
        return [
          app._id,
          {
            productId: app._id,
            name: app.title,
            useSameEmailAsAdmin: !selection?.userEmail,
            userEmail: selection?.userEmail ?? payload.billingDetails.organizationEmail,
            supabaseUrl: config.supabaseUrl,
            supabaseAnonKey: config.supabaseAnonKey,
            edgeFunctionName: config.edgeFunctionName,
          },
        ];
      }),
    );

    const result = await this.purchasesService.processAppProvisioning({
      organizationId: payload.organizationId,
      billingDetails: payload.billingDetails,
      appProvisioningDetails,
      mode: payload.mode ?? 'buy',
      purchaseId: payload.purchaseId,
    });

    // Only apps that actually provisioned get an entitlement; a failed app is
    // retried later and recorded then.
    const access = await this.purchasesService.recordAppAccess(
      payload.organizationId,
      result.results.map((entry) => entry.productId),
      payload.mode ?? 'buy',
    );

    // The edge functions and seed triggers carry their own hardcoded defaults,
    // which drift from what the app currently expects. Re-apply the canonical
    // templates so a freshly provisioned organization is correct regardless.
    const defaultsApplied = await this.applyDefaultsAfterProvisioning(
      provisioningApps,
      payload.organizationId,
      actor,
    );

    await this.auditService.record(actor, {
      action: 'provisioning.run',
      organizationId: payload.organizationId,
      targetId: payload.purchaseId ?? null,
      summary: `Provisioned ${result.summary.successful}/${result.summary.total} app(s) for ${payload.billingDetails.organizationName}`,
      details: {
        mode: payload.mode ?? 'buy',
        apps: provisioningApps.map((app) => app.title),
        summary: result.summary,
        errors: result.errors,
        access,
        defaultsApplied,
      },
    });

    return { ...result, access, defaultsApplied };
  }

  /**
   * Best-effort: a template that fails to apply must not fail the provisioning
   * that already succeeded, so problems are reported rather than thrown.
   */
  private async applyDefaultsAfterProvisioning(
    provisioningApps: { _id: string; title: string; appProvisioning?: { supabaseUrl?: string } }[],
    organizationId: string,
    actor: User | undefined,
  ) {
    const registry = this.appsService.getAllApps();
    const outcomes: { app: string; applied: string[]; error?: string }[] = [];

    for (const app of provisioningApps) {
      const matched = registry.find((entry) =>
        sameProject(entry.supabaseUrl, app.appProvisioning?.supabaseUrl),
      );
      // Products outside the registry have no service-role credentials here,
      // so their defaults cannot be applied.
      if (!matched || !this.appsService.isConfigured(matched.id)) continue;

      try {
        const result = await this.defaultsService.applyToOrganization(
          matched.id,
          organizationId,
          undefined,
          actor,
        );
        outcomes.push({ app: app.title, applied: result.applied });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        // No templates configured yet is the normal case, not a failure.
        if (!/No active default templates|unavailable/i.test(message)) {
          outcomes.push({ app: app.title, applied: [], error: message });
        }
      }
    }

    return outcomes;
  }

  async sendConfirmationEmail(payload: SendConfirmationDto, actor: User | undefined) {
    await this.purchasesService.sendPurchaseConfirmationEmail(
      payload.organizationDetails,
      payload.items,
      payload.total,
    );

    await this.auditService.record(actor, {
      action: 'provisioning.confirmation_email',
      summary: `Sent a purchase confirmation to ${payload.organizationDetails.organizationEmail}`,
      details: { total: payload.total, items: payload.items.length },
    });

    return { success: true };
  }

  /** Manual purchases, newest first, with the organization they belong to. */
  async listHistory(params: PaginationQueryDto): Promise<PaginatedResult<unknown>> {
    const { page = 1, limit = 25, search } = params;
    const [start, end] = toRange(page, limit);

    let query = this.supabaseService
      .getServiceRoleClient()
      .from('purchases')
      .select('*, organizations(id, name, email, phone)', { count: 'exact' })
      .eq('payment_provider', 'manual');

    if (search) {
      const term = search.replace(/[,()*]/g, '').trim();
      query = query.or(`client_reference.ilike.%${term}%,payment_reference.ilike.%${term}%`);
    }

    const { data, error, count } = await query
      .order('created_at', { ascending: false })
      .range(start, end);

    if (error) {
      throw new InternalServerErrorException(
        `Failed to load provisioning history: ${error.message}`,
      );
    }

    return paginated(data, count, page, limit);
  }
}
