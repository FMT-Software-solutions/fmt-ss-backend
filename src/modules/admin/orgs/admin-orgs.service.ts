import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { AppsService } from '../../apps/apps.service';
import { SupabaseService } from '../../../common/supabase/supabase.service';
import { AdminAuditService } from '../audit/admin-audit.service';
import {
  buildSearchFilter,
  paginated,
  parseSort,
  toRange,
  type PaginatedResult,
} from '../../../common/utils/paginate';
import type { AppCapabilities } from '../../apps/apps.config';
import type { OrgListQueryDto } from './dto/orgs-query.dto';

export interface FanOutFailure {
  [appId: string]: string;
}

@Injectable()
export class AdminOrgsService {
  private readonly logger = new Logger(AdminOrgsService.name);

  constructor(
    private readonly appsService: AppsService,
    private readonly supabaseService: SupabaseService,
    private readonly auditService: AdminAuditService,
  ) { }

  /** Resolves an app id to its client, rejecting unknown or unconfigured apps. */
  private clientFor(appId: string): { client: SupabaseClient; capabilities: AppCapabilities } {
    const config = this.appsService.getAppConfig(appId);
    if (!this.appsService.isConfigured(appId)) {
      throw new NotFoundException(
        `${config.name} has no Supabase credentials configured on the server`,
      );
    }
    return { client: this.appsService.getSupabaseClient(appId), capabilities: config.capabilities };
  }

  getRegistry() {
    return this.appsService.getPublicRegistry();
  }

  /**
   * Per-app counts for the dashboard. One app being down or misconfigured
   * must not blank the whole view, so failures are reported alongside the
   * results rather than thrown.
   */
  async getSummary() {
    const apps = this.appsService.getAllApps();
    const errors: FanOutFailure = {};

    const results = await Promise.all(
      apps.map(async (app) => {
        if (!this.appsService.isConfigured(app.id)) {
          errors[app.id] = 'No Supabase credentials configured';
          return { appId: app.id, name: app.name, configured: false as const };
        }

        try {
          const client = this.appsService.getSupabaseClient(app.id);
          const headCount = { count: 'exact' as const, head: true };

          const [organizations, active, users, balances] = await Promise.all([
            client.from('organizations').select('id', headCount),
            client.from('organizations').select('id', headCount).eq('is_active', true),
            client.from('user_organizations').select('id', headCount).eq('is_active', true),
            client.from('organization_sms_balances').select('credit_balance'),
          ]);

          const firstError =
            organizations.error || active.error || users.error || balances.error;
          if (firstError) throw new Error(firstError.message);

          const smsCredits = (balances.data ?? []).reduce(
            (sum, row: { credit_balance: number | null }) => sum + Number(row.credit_balance ?? 0),
            0,
          );

          return {
            appId: app.id,
            name: app.name,
            configured: true as const,
            organizations: organizations.count ?? 0,
            activeOrganizations: active.count ?? 0,
            users: users.count ?? 0,
            smsCredits,
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown error';
          this.logger.warn(`Summary failed for ${app.id}: ${message}`);
          errors[app.id] = message;
          return { appId: app.id, name: app.name, configured: true as const };
        }
      }),
    );

    return { data: results, errors };
  }

  async listOrganizations(appId: string, params: OrgListQueryDto): Promise<PaginatedResult<unknown>> {
    const { client } = this.clientFor(appId);
    const { page = 1, limit = 25, search, sort, isActive, hasPurchased } = params;
    const order = parseSort(sort, ['created_at', 'name', 'email'], {
      column: 'created_at',
      ascending: false,
    });
    const [start, end] = toRange(page, limit);

    let query = client
      .from('organizations')
      .select(
        'id, name, email, phone, is_active, has_purchased, trial_end_date, currency, created_at, organization_sms_balances(credit_balance), user_organizations(count)',
        { count: 'exact' },
      );

    if (isActive !== undefined) query = query.eq('is_active', isActive === 'true');
    if (hasPurchased !== undefined) query = query.eq('has_purchased', hasPurchased === 'true');
    if (search) query = query.or(buildSearchFilter(search, ['name', 'email', 'phone']));

    const { data, error, count } = await query
      .order(order.column, { ascending: order.ascending })
      .range(start, end);

    if (error) {
      throw new InternalServerErrorException(`Failed to load organizations: ${error.message}`);
    }

    // Flatten the embedded aggregates so the client sees plain numbers.
    const rows = (data ?? []).map((row: any) => ({
      ...row,
      smsCredits: row.organization_sms_balances?.credit_balance ?? 0,
      memberCount: row.user_organizations?.[0]?.count ?? 0,
      organization_sms_balances: undefined,
      user_organizations: undefined,
    }));

    return paginated(rows, count, page, limit);
  }

  async getOrganization(appId: string, orgId: string) {
    const { client, capabilities } = this.clientFor(appId);

    const [organization, branches, balance, transactions] = await Promise.all([
      client.from('organizations').select('*').eq('id', orgId).maybeSingle(),
      client
        .from('branches')
        .select('id, name, location, contact, is_active, created_at')
        .eq('organization_id', orgId),
      client
        .from('organization_sms_balances')
        .select('*')
        .eq('organization_id', orgId)
        .maybeSingle(),
      client
        .from('sms_credit_transactions')
        .select('id, type, amount, description, created_at')
        .eq('organization_id', orgId)
        .order('created_at', { ascending: false })
        .limit(10),
    ]);

    if (organization.error) {
      throw new InternalServerErrorException(
        `Failed to load organization: ${organization.error.message}`,
      );
    }
    if (!organization.data) throw new NotFoundException('Organization not found');

    let subApps: unknown[] = [];
    if (capabilities.hasSubApps) {
      const [installed, catalog] = await Promise.all([
        client
          .from('organization_apps')
          .select('id, app_id, settings, access_levels, created_at')
          .eq('organization_id', orgId),
        client.from('apps').select('id, name, displayName, description'),
      ]);

      // organization_apps only stores the app uuid, so resolve names from the
      // catalog rather than showing raw ids.
      const byId = new Map((catalog.data ?? []).map((app: any) => [app.id, app]));
      subApps = (installed.data ?? []).map((row: any) => ({
        ...row,
        name: byId.get(row.app_id)?.displayName ?? byId.get(row.app_id)?.name ?? null,
        description: byId.get(row.app_id)?.description ?? null,
      }));
    }

    return {
      organization: organization.data,
      branches: branches.data ?? [],
      smsBalance: balance.data ?? null,
      recentSmsTransactions: transactions.data ?? [],
      subApps,
      capabilities,
    };
  }

  /**
   * Membership list. The embed is disambiguated by column (`profiles!user_id`)
   * because church-hub and stockflow have several foreign keys between
   * user_organizations and profiles, which makes an unqualified embed
   * ambiguous.
   */
  async listOrganizationUsers(appId: string, orgId: string) {
    const { client, capabilities } = this.clientFor(appId);

    const roleEmbed = capabilities.hasDynamicRoles ? ', organization_roles(id, name, type)' : '';
    const { data, error } = await client
      .from('user_organizations')
      .select(
        `*, profiles!user_id(id, email, first_name, last_name, phone, avatar)${roleEmbed}`,
      )
      .eq('organization_id', orgId)
      .order('created_at', { ascending: true });

    if (error) {
      throw new InternalServerErrorException(`Failed to load users: ${error.message}`);
    }

    const members = (data ?? []).map((row: any) => ({
      id: row.id,
      userId: row.user_id,
      email: row.profiles?.email ?? null,
      firstName: row.profiles?.first_name ?? null,
      lastName: row.profiles?.last_name ?? null,
      phone: row.profiles?.phone ?? null,
      role: row.role ?? null,
      roleName: row.organization_roles?.name ?? null,
      roleType: row.organization_roles?.type ?? null,
      isActive: row.is_active ?? null,
      createdAt: row.created_at ?? null,
      // Per-app extras: the override column and boolean flags differ by app.
      overrides: capabilities.membershipOverrideColumn
        ? (row[capabilities.membershipOverrideColumn] ?? null)
        : null,
      flags: Object.fromEntries(
        (capabilities.membershipFlags ?? []).map((flag) => [flag, row[flag] ?? null]),
      ),
    }));

    return { data: members, meta: { total: members.length } };
  }

  async listOrganizationRoles(appId: string, orgId: string) {
    const { client, capabilities } = this.clientFor(appId);

    if (!capabilities.hasDynamicRoles) {
      return {
        dynamic: false as const,
        staticRoles: capabilities.staticRoles ?? [],
        data: [],
      };
    }

    const { data, error } = await client
      .from('organization_roles')
      .select('id, name, type, description, permissions, created_at')
      .eq('organization_id', orgId)
      .order('created_at', { ascending: true });

    if (error) {
      throw new InternalServerErrorException(`Failed to load roles: ${error.message}`);
    }

    // permissions is stored as a JSON string in these projects; parse it so the
    // client doesn't have to know that.
    const roles = (data ?? []).map((role: any) => ({
      ...role,
      permissions: safeParse(role.permissions),
    }));

    return { dynamic: true as const, staticRoles: [], data: roles };
  }

  /**
   * Grants or removes SMS credits. Goes through the admin_adjust_sms_credits
   * RPC so the balance update and the ledger entry happen together, and so the
   * entry is typed 'bonus'/'usage' rather than masquerading as a purchase.
   */
  async adjustSmsCredits(
    appId: string,
    orgId: string,
    delta: number,
    reason: string,
    actor: User | undefined,
  ) {
    const { client } = this.clientFor(appId);
    const organization = await this.requireOrganization(client, orgId);

    const { data, error } = await client.rpc('admin_adjust_sms_credits', {
      p_org_id: orgId,
      p_delta: delta,
      p_reason: reason,
      p_actor: actor?.email ?? 'unknown admin',
      p_metadata: { source: 'admin-console' },
    });

    if (error) {
      // PostgREST reports a missing function as "Could not find the function
      // ... in the schema cache"; older/direct errors say "does not exist".
      if (/could not find the function|does not exist/i.test(error.message)) {
        throw new BadRequestException(
          `${this.appsService.getAppConfig(appId).name} is missing admin_adjust_sms_credits — run supabase_migrations/20260817_admin_adjust_sms_credits.sql in its Supabase project.`,
        );
      }
      throw new InternalServerErrorException(`Failed to adjust credits: ${error.message}`);
    }

    const result = data as { previous_balance: number; new_balance: number };

    await this.auditService.record(actor, {
      action: delta > 0 ? 'sms_credits.grant' : 'sms_credits.deduct',
      appId,
      organizationId: orgId,
      summary: `${delta > 0 ? 'Granted' : 'Removed'} ${Math.abs(delta)} credits ${delta > 0 ? 'to' : 'from'} ${organization.name ?? orgId}`,
      details: {
        delta,
        reason,
        previousBalance: result?.previous_balance,
        newBalance: result?.new_balance,
      },
    });

    return result;
  }

  /**
   * Updates organization settings. Only whitelisted columns are written, and
   * ai_daily_limit is rejected for apps whose schema lacks it.
   *
   * Note for stock-flow: a BEFORE UPDATE trigger nulls trial_end_date whenever
   * has_purchased is true, and backfills 30 days from created_at when it is
   * false and the date is null. The response returns the row as stored so the
   * client always shows what the database actually kept.
   */
  async updateOrganization(
    appId: string,
    orgId: string,
    patch: Record<string, unknown>,
    actor: User | undefined,
  ) {
    const { client, capabilities } = this.clientFor(appId);
    const before = await this.requireOrganization(client, orgId);

    if (patch.ai_daily_limit !== undefined && !capabilities.hasAiDailyLimit) {
      throw new BadRequestException(
        `${this.appsService.getAppConfig(appId).name} does not have an AI daily limit`,
      );
    }

    const changes = Object.fromEntries(
      Object.entries(patch).filter(([, value]) => value !== undefined),
    );
    if (Object.keys(changes).length === 0) {
      throw new BadRequestException('No changes supplied');
    }

    const { data, error } = await client
      .from('organizations')
      .update({ ...changes, updated_at: new Date().toISOString() })
      .eq('id', orgId)
      .select()
      .maybeSingle();

    if (error) {
      throw new InternalServerErrorException(`Failed to update organization: ${error.message}`);
    }

    // Record what actually changed, old value included, so the log is readable.
    const diff = Object.fromEntries(
      Object.keys(changes).map((key) => [
        key,
        { from: (before as Record<string, unknown>)[key] ?? null, to: (data as any)?.[key] ?? null },
      ]),
    );

    await this.auditService.record(actor, {
      action: 'organization.update',
      appId,
      organizationId: orgId,
      summary: `Updated ${Object.keys(changes).join(', ')} on ${before.name ?? orgId}`,
      details: { changes: diff },
    });

    return data;
  }

  async updateMember(
    appId: string,
    orgId: string,
    membershipId: string,
    isActive: boolean,
    actor: User | undefined,
  ) {
    const { client } = this.clientFor(appId);

    const { data, error } = await client
      .from('user_organizations')
      .update({ is_active: isActive, updated_at: new Date().toISOString() })
      .eq('id', membershipId)
      .eq('organization_id', orgId)
      .select('id, user_id, role, is_active')
      .maybeSingle();

    if (error) {
      throw new InternalServerErrorException(`Failed to update member: ${error.message}`);
    }
    if (!data) throw new NotFoundException('Membership not found in this organization');

    await this.auditService.record(actor, {
      action: isActive ? 'member.activate' : 'member.deactivate',
      appId,
      organizationId: orgId,
      targetId: membershipId,
      summary: `${isActive ? 'Activated' : 'Deactivated'} a member`,
      details: { membershipId, isActive },
    });

    return data;
  }

  private async requireOrganization(client: SupabaseClient, orgId: string) {
    const { data, error } = await client
      .from('organizations')
      .select('*')
      .eq('id', orgId)
      .maybeSingle();

    if (error) {
      throw new InternalServerErrorException(`Failed to load organization: ${error.message}`);
    }
    if (!data) throw new NotFoundException('Organization not found');
    return data as Record<string, unknown> & { name?: string | null };
  }

  /** Billing-side organizations from the MAIN project, with their entitlements. */
  async listMainOrganizations(params: OrgListQueryDto): Promise<PaginatedResult<unknown>> {
    const { page = 1, limit = 25, search, sort } = params;
    const order = parseSort(sort, ['created_at', 'name', 'email'], {
      column: 'created_at',
      ascending: false,
    });
    const [start, end] = toRange(page, limit);

    let query = this.supabaseService
      .getServiceRoleClient()
      .from('organizations')
      .select('*, organization_apps(id, app_id, status, plan_type, expires_at)', {
        count: 'exact',
      });

    if (search) query = query.or(buildSearchFilter(search, ['name', 'email', 'phone']));

    const { data, error, count } = await query
      .order(order.column, { ascending: order.ascending })
      .range(start, end);

    if (error) {
      throw new InternalServerErrorException(`Failed to load organizations: ${error.message}`);
    }

    return paginated(data, count, page, limit);
  }
}

function safeParse(value: unknown) {
  if (typeof value !== 'string') return value ?? null;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}
