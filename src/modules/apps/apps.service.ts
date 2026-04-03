import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { AppConfig, getRegisteredApps } from './apps.config';

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
}