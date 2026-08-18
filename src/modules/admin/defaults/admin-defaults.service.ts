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

export type TemplateKind = 'branding' | 'roles' | 'organization_settings';

/** Organization columns the branding template owns. */
const BRANDING_FIELDS = [
  'brand_colors',
  'theme_name',
  'logo_settings',
  'notification_settings',
] as const;

/** Organization columns the settings template owns; `currency` etc. are safe to standardise. */
const SETTINGS_FIELDS = ['currency', 'ai_daily_limit'] as const;

interface RoleTemplateEntry {
  name: string;
  type?: string | null;
  description?: string | null;
  permissions?: unknown;
}

/** Deep equality that ignores key order, which JSON columns do not preserve. */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || a === undefined || b === undefined) return a === b;
  if (typeof a !== typeof b) return false;
  if (typeof a !== 'object') return a === b;

  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, index) => deepEqual(item, b[index]));
  }

  const aKeys = Object.keys(a as object).sort();
  const bKeys = Object.keys(b as object).sort();
  if (aKeys.length !== bKeys.length || aKeys.some((key, i) => key !== bKeys[i])) return false;
  return aKeys.every((key) =>
    deepEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]),
  );
}

/** Role permissions are stored as a JSON string in these projects. */
function parsePermissions(value: unknown) {
  if (typeof value !== 'string') return value ?? null;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

@Injectable()
export class AdminDefaultsService {
  private readonly logger = new Logger(AdminDefaultsService.name);

  constructor(
    private readonly appsService: AppsService,
    private readonly supabaseService: SupabaseService,
    private readonly auditService: AdminAuditService,
  ) { }

  private get main() {
    return this.supabaseService.getServiceRoleClient();
  }

  private clientFor(appId: string): SupabaseClient {
    const config = this.appsService.getAppConfig(appId);
    if (!this.appsService.isConfigured(appId)) {
      throw new NotFoundException(`${config.name} has no Supabase credentials configured`);
    }
    return this.appsService.getSupabaseClient(appId);
  }

  async listTemplates(appId: string) {
    this.appsService.getAppConfig(appId);

    const { data, error } = await this.main
      .from('app_default_templates')
      .select('*')
      .eq('app_id', appId);

    if (error) {
      if (/could not find the table|does not exist/i.test(error.message)) {
        return { templates: [], unavailable: true as const };
      }
      throw new InternalServerErrorException(`Failed to load templates: ${error.message}`);
    }

    return { templates: data ?? [], unavailable: false as const };
  }

  async upsertTemplate(
    appId: string,
    kind: TemplateKind,
    payload: Record<string, unknown>,
    notes: string | undefined,
    actor: User | undefined,
  ) {
    this.appsService.getAppConfig(appId);

    const { data, error } = await this.main
      .from('app_default_templates')
      .upsert(
        {
          app_id: appId,
          kind,
          payload: payload as never,
          notes: notes ?? null,
          updated_by: actor?.email ?? null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'app_id,kind' },
      )
      .select()
      .single();

    if (error) {
      throw new InternalServerErrorException(`Failed to save template: ${error.message}`);
    }

    await this.auditService.record(actor, {
      action: 'defaults.template_saved',
      appId,
      summary: `Saved the ${kind} default template for ${this.appsService.getAppConfig(appId).name}`,
      details: { kind, notes: notes ?? null },
    });

    return data;
  }

  /**
   * Reads the current values off a known-good organization so a template can be
   * seeded from reality rather than hand-written JSON.
   */
  async captureFromOrganization(appId: string, orgId: string, kind: TemplateKind) {
    const client = this.clientFor(appId);

    const { data: organization, error } = await client
      .from('organizations')
      .select('*')
      .eq('id', orgId)
      .maybeSingle();

    if (error) {
      throw new InternalServerErrorException(`Failed to read organization: ${error.message}`);
    }
    if (!organization) throw new NotFoundException('Organization not found');

    if (kind === 'branding') {
      return Object.fromEntries(
        BRANDING_FIELDS.filter((field) => organization[field] !== undefined).map((field) => [
          field,
          organization[field],
        ]),
      );
    }

    if (kind === 'organization_settings') {
      return Object.fromEntries(
        SETTINGS_FIELDS.filter((field) => organization[field] !== undefined).map((field) => [
          field,
          organization[field],
        ]),
      );
    }

    const capabilities = this.appsService.getAppConfig(appId).capabilities;
    if (!capabilities.hasDynamicRoles) {
      throw new BadRequestException(
        `${this.appsService.getAppConfig(appId).name} does not use a roles table`,
      );
    }

    const { data: roles, error: rolesError } = await client
      .from('organization_roles')
      .select('name, type, description, permissions')
      .eq('organization_id', orgId)
      .order('created_at', { ascending: true });

    if (rolesError) {
      throw new InternalServerErrorException(`Failed to read roles: ${rolesError.message}`);
    }

    return {
      roles: (roles ?? []).map((role) => ({
        name: role.name,
        type: role.type,
        description: role.description,
        permissions: parsePermissions(role.permissions),
      })),
    };
  }

  /**
   * Compares an organization against the stored templates. Reports what would
   * change without changing anything, so drift is visible before it is fixed.
   */
  async checkOrganization(appId: string, orgId: string) {
    const client = this.clientFor(appId);
    const { templates, unavailable } = await this.listTemplates(appId);

    if (unavailable) {
      return { unavailable: true as const, checks: [], inSync: false };
    }

    const { data: organization } = await client
      .from('organizations')
      .select('*')
      .eq('id', orgId)
      .maybeSingle();

    if (!organization) throw new NotFoundException('Organization not found');

    const checks: {
      kind: TemplateKind;
      inSync: boolean;
      differences: { field: string; current: unknown; expected: unknown }[];
    }[] = [];

    for (const template of templates) {
      if (!template.is_active) continue;
      const kind = template.kind as TemplateKind;
      const payload = (template.payload ?? {}) as Record<string, unknown>;

      if (kind === 'branding' || kind === 'organization_settings') {
        const differences = Object.entries(payload)
          .filter(([field]) => field in organization)
          .filter(([field, expected]) => !deepEqual(organization[field], expected))
          .map(([field, expected]) => ({
            field,
            current: organization[field],
            expected,
          }));

        checks.push({ kind, inSync: differences.length === 0, differences });
        continue;
      }

      if (kind === 'roles') {
        const expectedRoles = (payload.roles ?? []) as RoleTemplateEntry[];
        const { data: currentRoles } = await client
          .from('organization_roles')
          .select('name, type, description, permissions')
          .eq('organization_id', orgId);

        const byName = new Map(
          (currentRoles ?? []).map((role) => [role.name, role]),
        );

        const differences = expectedRoles
          .map((expected) => {
            const current = byName.get(expected.name);
            if (!current) {
              return { field: `role:${expected.name}`, current: null, expected: 'present' };
            }
            return deepEqual(parsePermissions(current.permissions), expected.permissions)
              ? null
              : {
                field: `role:${expected.name}.permissions`,
                current: parsePermissions(current.permissions),
                expected: expected.permissions,
              };
          })
          .filter(Boolean) as { field: string; current: unknown; expected: unknown }[];

        checks.push({ kind, inSync: differences.length === 0, differences });
      }
    }

    return {
      unavailable: false as const,
      checks,
      inSync: checks.every((check) => check.inSync),
    };
  }

  /**
   * Applies the stored templates onto an organization. Roles are upserted by
   * name — existing roles have their permissions corrected and missing ones are
   * created; roles the organization added itself are left alone.
   */
  async applyToOrganization(
    appId: string,
    orgId: string,
    kinds: TemplateKind[] | undefined,
    actor: User | undefined,
  ) {
    const client = this.clientFor(appId);
    const { templates, unavailable } = await this.listTemplates(appId);

    if (unavailable) {
      throw new BadRequestException(
        'Default templates are unavailable — run supabase_migrations/20260817_app_default_templates.sql in the main project.',
      );
    }

    const selected = templates.filter(
      (template) =>
        template.is_active && (!kinds?.length || kinds.includes(template.kind as TemplateKind)),
    );

    if (!selected.length) {
      throw new BadRequestException('No active default templates to apply for this app');
    }

    const applied: string[] = [];
    const failures: { kind: string; error: string }[] = [];

    for (const template of selected) {
      const kind = template.kind as TemplateKind;
      const payload = (template.payload ?? {}) as Record<string, unknown>;

      try {
        if (kind === 'branding' || kind === 'organization_settings') {
          const update = Object.fromEntries(
            Object.entries(payload).filter(([field]) =>
              (kind === 'branding' ? BRANDING_FIELDS : SETTINGS_FIELDS).includes(field as never),
            ),
          );
          if (!Object.keys(update).length) continue;

          const { error } = await client
            .from('organizations')
            .update({ ...update, updated_at: new Date().toISOString() })
            .eq('id', orgId);
          if (error) throw new Error(error.message);
          applied.push(kind);
        }

        if (kind === 'roles') {
          const expectedRoles = (payload.roles ?? []) as RoleTemplateEntry[];
          if (!expectedRoles.length) continue;

          const { data: currentRoles } = await client
            .from('organization_roles')
            .select('id, name')
            .eq('organization_id', orgId);
          const byName = new Map((currentRoles ?? []).map((role) => [role.name, role.id]));

          for (const role of expectedRoles) {
            const permissions =
              typeof role.permissions === 'string'
                ? role.permissions
                : JSON.stringify(role.permissions ?? {});

            const existingId = byName.get(role.name);
            const { error } = existingId
              ? await client
                .from('organization_roles')
                .update({
                  type: role.type ?? null,
                  description: role.description ?? null,
                  permissions,
                  updated_at: new Date().toISOString(),
                })
                .eq('id', existingId)
              : await client.from('organization_roles').insert({
                organization_id: orgId,
                name: role.name,
                type: role.type ?? 'custom',
                description: role.description ?? null,
                permissions,
              });

            if (error) throw new Error(`${role.name}: ${error.message}`);
          }
          applied.push(kind);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        this.logger.warn(`Applying ${kind} defaults to ${orgId} failed: ${message}`);
        failures.push({ kind, error: message });
      }
    }

    await this.auditService.record(actor, {
      action: 'defaults.applied',
      appId,
      organizationId: orgId,
      summary: `Applied default templates (${applied.join(', ') || 'none'}) to an organization`,
      details: { applied, failures },
    });

    return { applied, failures, success: failures.length === 0 };
  }
}
