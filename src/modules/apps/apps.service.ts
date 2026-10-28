import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { AppConfig, PublicAppConfig, getRegisteredApps } from './apps.config';

@Injectable()
export class AppsService {
  private readonly logger = new Logger(AppsService.name);
  private clients = new Map<string, SupabaseClient>();
  private configs = new Map<string, AppConfig>();

  constructor(private configService: ConfigService) {
    this.initializeApps();
  }

  private initializeApps() {
    const apps = getRegisteredApps(this.configService);
    apps.forEach((app) => {
      this.configs.set(app.id, app);
      
      if (app.supabaseUrl && app.supabaseServiceRoleKey) {
        const client = createClient(app.supabaseUrl, app.supabaseServiceRoleKey);
        this.clients.set(app.id, client);
        this.logger.log(`Initialized Supabase client for app: ${app.id}`);
      } else {
        this.logger.warn(`Missing Supabase credentials for app: ${app.id}`);
      }
    });
  }

  getAppConfig(appId: string): AppConfig {
    const config = this.configs.get(appId);
    if (!config) {
      throw new NotFoundException(`App configuration for ${appId} not found`);
    }
    return config;
  }

  getSupabaseClient(appId: string): SupabaseClient {
    const client = this.clients.get(appId);
    if (!client) {
      throw new NotFoundException(`Supabase client for app ${appId} is not configured properly or missing credentials`);
    }
    return client;
  }

  getAllApps(): AppConfig[] {
    return Array.from(this.configs.values());
  }

  /**
   * The service-role client for the app whose Supabase project is at `url`
   * (Sanity products store their provisioning URL, not our registry id).
   * Null when no configured app matches.
   */
  getClientForProjectUrl(url: string | undefined | null): SupabaseClient | null {
    const host = (value?: string | null) => {
      try {
        return value ? new URL(value).host : '';
      } catch {
        return '';
      }
    };
    const target = host(url);
    if (!target) return null;
    const app = this.getAllApps().find((a) => host(a.supabaseUrl) === target);
    return app ? (this.clients.get(app.id) ?? null) : null;
  }

  /** True when the app has usable Supabase credentials. */
  isConfigured(appId: string): boolean {
    return this.clients.has(appId);
  }

  /**
   * Registry for the admin client. Supabase URLs and service-role keys are
   * deliberately dropped — the browser must never receive them.
   */
  getPublicRegistry(): PublicAppConfig[] {
    return this.getAllApps().map(({ id, name, slug, description, capabilities }) => ({
      id,
      name,
      slug,
      description,
      capabilities,
      configured: this.isConfigured(id),
    }));
  }
}