import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { Database } from './database.types';

@Injectable()
export class SupabaseService implements OnModuleInit {
  private client: SupabaseClient<Database, 'public'>;
  private serviceRoleClient: SupabaseClient<Database, 'public'>;

  constructor(private configService: ConfigService) { }

  onModuleInit() {
    const supabaseUrl = this.configService.get<string>('SUPABASE_URL');
    const supabaseAnonKey = this.configService.get<string>('SUPABASE_ANON_KEY');
    const supabaseServiceRoleKey = this.configService.get<string>('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceRoleKey) {
      throw new Error('Supabase credentials not found in environment variables');
    }

    this.client = createClient<Database, 'public'>(supabaseUrl, supabaseAnonKey);
    this.serviceRoleClient = createClient<Database, 'public'>(supabaseUrl, supabaseServiceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
  }

  getClient() {
    return this.client;
  }

  getServiceRoleClient() {
    return this.serviceRoleClient;
  }
}
