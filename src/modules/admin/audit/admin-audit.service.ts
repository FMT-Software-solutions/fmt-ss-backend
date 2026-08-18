import { Injectable, Logger } from '@nestjs/common';
import type { User } from '@supabase/supabase-js';
import { SupabaseService } from '../../../common/supabase/supabase.service';

export interface AuditEntry {
  action: string;
  appId?: string | null;
  organizationId?: string | null;
  targetId?: string | null;
  summary?: string;
  details?: Record<string, unknown>;
}

@Injectable()
export class AdminAuditService {
  private readonly logger = new Logger(AdminAuditService.name);

  constructor(private readonly supabaseService: SupabaseService) { }

  /**
   * Records an admin write. Deliberately never throws: an audit failure must
   * not roll back or mask the action the admin actually performed, but it is
   * logged loudly so a broken audit trail is noticed.
   */
  async record(actor: User | undefined, entry: AuditEntry): Promise<void> {
    const { error } = await this.supabaseService
      .getServiceRoleClient()
      .from('admin_audit_log')
      .insert({
        actor_id: actor?.id ?? null,
        actor_email: actor?.email ?? null,
        action: entry.action,
        app_id: entry.appId ?? null,
        organization_id: entry.organizationId ?? null,
        target_id: entry.targetId ?? null,
        summary: entry.summary ?? null,
        details: (entry.details ?? {}) as never,
      });

    if (error) {
      this.logger.error(
        `AUDIT WRITE FAILED for "${entry.action}" by ${actor?.email ?? 'unknown'}: ${error.message || 'run supabase_migrations/20260817_admin_audit_log.sql'}`,
      );
    }
  }

  async list(params: { appId?: string; organizationId?: string; limit?: number }) {
    const { appId, organizationId, limit = 20 } = params;

    let query = this.supabaseService
      .getServiceRoleClient()
      .from('admin_audit_log')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(Math.min(limit, 100));

    if (appId) query = query.eq('app_id', appId);
    if (organizationId) query = query.eq('organization_id', organizationId);

    const { data, error } = await query;
    if (error) {
      this.logger.warn(`Could not read audit log: ${error.message}`);
      return { data: [], unavailable: true };
    }

    return { data: data ?? [], unavailable: false };
  }
}
