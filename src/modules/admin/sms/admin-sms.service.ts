import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { User } from '@supabase/supabase-js';
import { AppsService } from '../../apps/apps.service';
import { SupabaseService } from '../../../common/supabase/supabase.service';
import { ArkeselService } from '../../../common/arkesel/arkesel.service';
import { ResendService } from '../../../common/resend/resend.service';
import { AdminAuditService } from '../audit/admin-audit.service';
import { parseEmailList } from '../../../common/utils/email.utils';

export interface OrgBalanceRow {
  appId: string;
  appName: string;
  organizationId: string;
  organizationName: string | null;
  organizationEmail: string | null;
  organizationPhone: string | null;
  creditBalance: number;
  bonusCreditsReceived: number;
  isActive: boolean | null;
  belowThreshold: boolean;
}

@Injectable()
export class AdminSmsService {
  private readonly logger = new Logger(AdminSmsService.name);

  constructor(
    private readonly appsService: AppsService,
    private readonly supabaseService: SupabaseService,
    private readonly arkeselService: ArkeselService,
    private readonly resendService: ResendService,
    private readonly auditService: AdminAuditService,
    private readonly configService: ConfigService,
  ) { }

  private get main() {
    return this.supabaseService.getServiceRoleClient();
  }

  get lowBalanceThreshold(): number {
    return Number(this.configService.get('SMS_LOW_BALANCE_THRESHOLD') ?? 20);
  }

  get mainBalanceThreshold(): number {
    return Number(this.configService.get('ARKESEL_MAIN_BALANCE_THRESHOLD') ?? 500);
  }

  get alertCooldownHours(): number {
    return Number(this.configService.get('SMS_ALERT_COOLDOWN_HOURS') ?? 72);
  }

  /** FMT's own Arkesel wallet: SMS units plus the cash balance. */
  async getMainBalance() {
    try {
      const response = await this.arkeselService.checkBalance();
      const smsBalance = Number(response?.data?.sms_balance ?? 0);
      const cash = response?.data?.main_balance ?? null;

      return {
        smsBalance,
        cashBalance: cash,
        threshold: this.mainBalanceThreshold,
        low: smsBalance < this.mainBalanceThreshold,
        available: true as const,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.warn(`Could not read the Arkesel balance: ${message}`);
      return {
        smsBalance: null,
        cashBalance: null,
        threshold: this.mainBalanceThreshold,
        low: false,
        available: false as const,
        error: message,
      };
    }
  }

  /** Every organization's credit balance across every configured app. */
  async listBalances(): Promise<{ rows: OrgBalanceRow[]; errors: Record<string, string> }> {
    const errors: Record<string, string> = {};
    const threshold = this.lowBalanceThreshold;

    const perApp = await Promise.all(
      this.appsService.getAllApps().map(async (app) => {
        if (!this.appsService.isConfigured(app.id)) return [];

        try {
          const client = this.appsService.getSupabaseClient(app.id);
          const [balances, organizations] = await Promise.all([
            client
              .from('organization_sms_balances')
              .select('organization_id, credit_balance, bonus_credits_received'),
            client.from('organizations').select('id, name, email, phone, is_active'),
          ]);

          if (balances.error) throw new Error(balances.error.message);
          if (organizations.error) throw new Error(organizations.error.message);

          const orgById = new Map((organizations.data ?? []).map((org) => [org.id, org]));

          // Organizations with no balance row have never been credited, which
          // is still zero credits and worth showing.
          return (organizations.data ?? []).map((org) => {
            const balance = (balances.data ?? []).find((row) => row.organization_id === org.id);
            const credits = Number(balance?.credit_balance ?? 0);
            return {
              appId: app.id,
              appName: app.name,
              organizationId: org.id,
              organizationName: orgById.get(org.id)?.name ?? null,
              organizationEmail: org.email ?? null,
              organizationPhone: org.phone ?? null,
              creditBalance: credits,
              bonusCreditsReceived: Number(balance?.bonus_credits_received ?? 0),
              isActive: org.is_active ?? null,
              belowThreshold: credits < threshold,
            } satisfies OrgBalanceRow;
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown error';
          this.logger.warn(`SMS balances failed for ${app.id}: ${message}`);
          errors[app.id] = message;
          return [];
        }
      }),
    );

    return { rows: perApp.flat(), errors };
  }

  /**
   * Headline comparison: what FMT holds at Arkesel versus what organizations
   * collectively hold as credits. A shortfall means outstanding credits could
   * not all be delivered.
   */
  async getOverview() {
    const [mainBalance, { rows, errors }] = await Promise.all([
      this.getMainBalance(),
      this.listBalances(),
    ]);

    const totalOrgCredits = rows.reduce((sum, row) => sum + row.creditBalance, 0);
    const byApp = this.appsService.getAllApps().map((app) => {
      const appRows = rows.filter((row) => row.appId === app.id);
      return {
        appId: app.id,
        appName: app.name,
        configured: this.appsService.isConfigured(app.id),
        organizations: appRows.length,
        credits: appRows.reduce((sum, row) => sum + row.creditBalance, 0),
        lowBalanceOrganizations: appRows.filter((row) => row.belowThreshold).length,
      };
    });

    const coverage =
      mainBalance.smsBalance !== null && totalOrgCredits > 0
        ? mainBalance.smsBalance / totalOrgCredits
        : null;

    return {
      mainBalance,
      totalOrgCredits,
      shortfall:
        mainBalance.smsBalance !== null
          ? Math.max(totalOrgCredits - mainBalance.smsBalance, 0)
          : null,
      coverage,
      lowBalanceOrganizations: rows.filter((row) => row.belowThreshold).length,
      threshold: this.lowBalanceThreshold,
      byApp,
      errors,
    };
  }

  /** Credit movements across apps, newest first. */
  async listTransactions(params: { appId?: string; organizationId?: string; limit?: number }) {
    const { appId, organizationId, limit = 50 } = params;
    const apps = appId
      ? this.appsService.getAllApps().filter((app) => app.id === appId)
      : this.appsService.getAllApps();

    const results = await Promise.all(
      apps.map(async (app) => {
        if (!this.appsService.isConfigured(app.id)) return [];

        let query = this.appsService
          .getSupabaseClient(app.id)
          .from('sms_credit_transactions')
          .select('id, organization_id, type, amount, description, created_at')
          .order('created_at', { ascending: false })
          .limit(Math.min(limit, 200));

        if (organizationId) query = query.eq('organization_id', organizationId);

        const { data, error } = await query;
        if (error) {
          this.logger.warn(`Transactions failed for ${app.id}: ${error.message}`);
          return [];
        }
        return (data ?? []).map((row) => ({ ...row, appId: app.id, appName: app.name }));
      }),
    );

    return results
      .flat()
      .sort((a, b) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')))
      .slice(0, limit);
  }

  /** Daily usage totals for charting, derived from the credit ledger. */
  async getUsage(params: { from?: string; to?: string; appId?: string }) {
    const to = params.to ? new Date(params.to) : new Date();
    const from = params.from
      ? new Date(params.from)
      : new Date(to.getTime() - 29 * 24 * 60 * 60 * 1000);

    const apps = params.appId
      ? this.appsService.getAllApps().filter((app) => app.id === params.appId)
      : this.appsService.getAllApps();

    const perApp = await Promise.all(
      apps.map(async (app) => {
        if (!this.appsService.isConfigured(app.id)) return [];
        const { data, error } = await this.appsService
          .getSupabaseClient(app.id)
          .from('sms_credit_transactions')
          .select('type, amount, created_at')
          .gte('created_at', from.toISOString())
          .lte('created_at', to.toISOString());

        if (error) {
          this.logger.warn(`Usage failed for ${app.id}: ${error.message}`);
          return [];
        }
        return (data ?? []).map((row) => ({ ...row, appId: app.id, appName: app.name }));
      }),
    );

    const rows = perApp.flat();
    const byDay = new Map<string, { date: string; used: number; purchased: number; bonus: number }>();

    for (const row of rows) {
      const date = String(row.created_at ?? '').slice(0, 10);
      if (!date) continue;
      const entry = byDay.get(date) ?? { date, used: 0, purchased: 0, bonus: 0 };
      const amount = Number(row.amount ?? 0);
      if (row.type === 'usage') entry.used += Math.abs(amount);
      if (row.type === 'purchase') entry.purchased += amount;
      if (row.type === 'bonus') entry.bonus += amount;
      byDay.set(date, entry);
    }

    const series = [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date));

    return {
      from: from.toISOString(),
      to: to.toISOString(),
      series,
      totals: {
        used: series.reduce((sum, day) => sum + day.used, 0),
        purchased: series.reduce((sum, day) => sum + day.purchased, 0),
        bonus: series.reduce((sum, day) => sum + day.bonus, 0),
      },
      byApp: apps.map((app) => ({
        appId: app.id,
        appName: app.name,
        used: rows
          .filter((row) => row.appId === app.id && row.type === 'usage')
          .reduce((sum, row) => sum + Math.abs(Number(row.amount ?? 0)), 0),
      })),
    };
  }

  /** Which organizations the sweep would warn right now, and why. */
  async getAlertCandidates() {
    const { rows, errors } = await this.listBalances();
    const candidates = rows.filter((row) => row.belowThreshold && row.isActive !== false);

    const cooldownSince = new Date(
      Date.now() - this.alertCooldownHours * 60 * 60 * 1000,
    ).toISOString();

    const { data: recent, error } = await this.main
      .from('sms_balance_alerts')
      .select('app_id, organization_id, created_at')
      .eq('alert_type', 'org_low_balance')
      .gte('created_at', cooldownSince);

    const alertsUnavailable = Boolean(error);
    const recentKeys = new Set(
      (recent ?? []).map((row) => `${row.app_id}:${row.organization_id}`),
    );

    return {
      threshold: this.lowBalanceThreshold,
      cooldownHours: this.alertCooldownHours,
      alertsUnavailable,
      errors,
      candidates: candidates.map((row) => ({
        ...row,
        contactable: Boolean(row.organizationPhone),
        inCooldown: recentKeys.has(`${row.appId}:${row.organizationId}`),
        wouldAlert:
          Boolean(row.organizationPhone) &&
          !recentKeys.has(`${row.appId}:${row.organizationId}`),
      })),
    };
  }

  /** Sends one low-balance SMS to an organization's registered phone number. */
  async sendLowBalanceAlert(
    appId: string,
    organizationId: string,
    actor: User | undefined,
    triggeredBy: 'cron' | 'admin' = 'admin',
  ) {
    const app = this.appsService.getAppConfig(appId);
    if (!this.appsService.isConfigured(appId)) {
      throw new NotFoundException(`${app.name} has no Supabase credentials configured`);
    }

    const client = this.appsService.getSupabaseClient(appId);
    const [{ data: organization }, { data: balance }] = await Promise.all([
      client
        .from('organizations')
        .select('id, name, phone, sms_sender_id')
        .eq('id', organizationId)
        .maybeSingle(),
      client
        .from('organization_sms_balances')
        .select('credit_balance')
        .eq('organization_id', organizationId)
        .maybeSingle(),
    ]);

    if (!organization) throw new NotFoundException('Organization not found');
    if (!organization.phone) {
      throw new BadRequestException(
        `${organization.name ?? 'This organization'} has no phone number on record`,
      );
    }

    const credits = Number(balance?.credit_balance ?? 0);
    // Arkesel caps sender IDs at 11 characters, which "FMTSoftware" exactly fills.
    const sender =
      this.configService.get<string>('SMS_ALERT_SENDER_ID') ||
      organization.sms_sender_id ||
      'FMTSoftware';
    const message =
      `Hello ${organization.name ?? 'there'}, your ${app.name} SMS balance is low ` +
      `(${credits} credit${credits === 1 ? '' : 's'} left). Top up in the app to keep sending messages.`;

    let succeeded = true;
    let error: string | null = null;

    try {
      await this.arkeselService.sendStandardSms(sender, message, [organization.phone]);
    } catch (sendError) {
      succeeded = false;
      error = sendError instanceof Error ? sendError.message : 'Unknown error';
    }

    await this.recordAlert({
      alert_type: 'org_low_balance',
      app_id: appId,
      organization_id: organizationId,
      organization_name: organization.name ?? null,
      recipient: organization.phone,
      balance_at_alert: credits,
      threshold: this.lowBalanceThreshold,
      channel: 'sms',
      triggered_by: triggeredBy,
      succeeded,
      error,
    });

    if (triggeredBy === 'admin') {
      await this.auditService.record(actor, {
        action: 'sms.low_balance_alert',
        appId,
        organizationId,
        summary: `Sent a low-balance SMS to ${organization.name ?? organizationId}`,
        details: { credits, recipient: organization.phone, succeeded, error },
      });
    }

    if (!succeeded) {
      throw new BadRequestException(`Could not send the alert: ${error}`);
    }

    return { success: true, credits, recipient: organization.phone };
  }

  /** Emails the FMT team when the Arkesel wallet cannot cover outstanding credits. */
  async sendMainBalanceWarning(overview: Awaited<ReturnType<AdminSmsService['getOverview']>>) {
    const recipients = parseEmailList(this.configService.get('ADMIN_EMAILS'));
    const to = recipients.length ? recipients : ['fmtsoftwaresolutions@gmail.com'];
    const { mainBalance, totalOrgCredits, shortfall } = overview;

    let succeeded = true;
    let error: string | null = null;

    try {
      await this.resendService.sendEmail({
        from: 'FMT Software Solutions <alerts@fmtsoftware.com>',
        to,
        subject: 'Arkesel SMS balance needs attention',
        html: `
          <h2>Arkesel balance warning</h2>
          <p>The Arkesel account holds <strong>${mainBalance.smsBalance ?? 'unknown'}</strong> SMS,
          while organizations collectively hold <strong>${totalOrgCredits}</strong> credits.</p>
          ${shortfall ? `<p>Shortfall: <strong>${shortfall}</strong> credits could not be delivered today.</p>` : ''}
          <p>Cash balance: ${mainBalance.cashBalance ?? 'unknown'}</p>
          <p>Top up the Arkesel account to keep customer messaging working.</p>
        `,
      });
    } catch (sendError) {
      succeeded = false;
      error = sendError instanceof Error ? sendError.message : 'Unknown error';
      this.logger.error(`Could not email the main balance warning: ${error}`);
    }

    await this.recordAlert({
      alert_type: 'main_low_balance',
      balance_at_alert: mainBalance.smsBalance,
      threshold: this.mainBalanceThreshold,
      channel: 'email',
      triggered_by: 'cron',
      recipient: to.join(', '),
      succeeded,
      error,
    });

    return { succeeded, error };
  }

  async listAlertHistory(limit = 25) {
    const { data, error } = await this.main
      .from('sms_balance_alerts')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(Math.min(limit, 100));

    if (error) return { data: [], unavailable: true as const };
    return { data: data ?? [], unavailable: false as const };
  }

  /** Alert logging must never break the alert itself. */
  private async recordAlert(entry: Record<string, unknown>) {
    const { error } = await this.main.from('sms_balance_alerts').insert(entry as never);
    if (error) {
      this.logger.error(
        `Could not record the SMS alert (cooldowns will not work): ${error.message || 'run supabase_migrations/20260817_sms_balance_alerts.sql'}`,
      );
    }
  }
}
