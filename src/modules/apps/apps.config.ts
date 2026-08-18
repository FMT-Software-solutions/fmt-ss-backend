import { ConfigService } from '@nestjs/config';

/**
 * What each product's schema actually supports. Verified against the live
 * projects — the three apps share most table names but diverge on roles,
 * sub-apps and a few organization columns, and the admin console branches on
 * these flags rather than hard-coding app ids.
 */
export interface AppCapabilities {
    /** organization_roles table + user_organizations.role_id (pcp, stockflow). */
    hasDynamicRoles: boolean;
    /** apps + organization_apps sub-app catalog (print-calc-pro only). */
    hasSubApps: boolean;
    /** grant_welcome_sms_credits trigger on org creation (print-calc-pro only). */
    hasWelcomeCredits: boolean;
    /** record_sms_delivery RPC for Arkesel delivery receipts (print-calc-pro only). */
    hasSmsDeliveryTracking: boolean;
    /** organizations.ai_daily_limit (absent on church-hub). */
    hasAiDailyLimit: boolean;
    /** Role values when roles are static rather than table-driven. */
    staticRoles?: string[];
    /** Column holding a per-member permission override, if any. */
    membershipOverrideColumn?: string;
    /** Extra boolean capability columns on user_organizations. */
    membershipFlags?: string[];
}

export interface AppConfig {
    id: string; // The unique app ID (e.g. 'church-hub-360')
    name: string; // Display name
    slug: string;
    description: string;
    supabaseUrl: string;
    supabaseServiceRoleKey: string;
    envPrefix: string; // Prefix for env variables, e.g. 'CHURCH_HUB_'
    capabilities: AppCapabilities;
}

/** The registry with credentials stripped — safe to send to the admin client. */
export type PublicAppConfig = Omit<AppConfig, 'supabaseUrl' | 'supabaseServiceRoleKey' | 'envPrefix'> & {
    configured: boolean;
};

export const getRegisteredApps = (configService: ConfigService): AppConfig[] => {
    return [
        {
            id: 'churchhub-360',
            name: 'Church Hub 360',
            slug: 'churchhub-360',
            description: 'All-in-one church management platform',
            envPrefix: 'CHURCH_HUB_',
            supabaseUrl: configService.get<string>('CHURCH_HUB_SUPABASE_URL') || '',
            supabaseServiceRoleKey: configService.get<string>('CHURCH_HUB_SUPABASE_SECRET_KEY') || '',
            capabilities: {
                hasDynamicRoles: false,
                hasSubApps: false,
                hasWelcomeCredits: false,
                hasSmsDeliveryTracking: false,
                hasAiDailyLimit: false,
                staticRoles: ['owner', 'admin', 'branch_admin', 'finance_admin', 'write', 'read'],
                membershipOverrideColumn: 'visibility_overrides',
                membershipFlags: ['can_create_users', 'can_approve_requests'],
            },
        },

        {
            id: 'stockflow',
            name: 'Stock Flow',
            slug: 'stockflow',
            description: 'Inventory management platform',
            envPrefix: 'STOCK_FLOW_',
            supabaseUrl: configService.get<string>('STOCK_FLOW_SUPABASE_URL') || '',
            supabaseServiceRoleKey: configService.get<string>('STOCK_FLOW_SUPABASE_SECRET_KEY') || '',
            capabilities: {
                hasDynamicRoles: true,
                hasSubApps: false,
                hasWelcomeCredits: false,
                hasSmsDeliveryTracking: false,
                hasAiDailyLimit: true,
                membershipOverrideColumn: 'permissions',
            },
        },

        {
            id: 'print-calc-pro',
            name: 'Print Suite Pro',
            slug: 'print-calc-pro',
            description: 'Printing business suite (Job Tracker, Price Calculator, Invoicing)',
            envPrefix: 'PRINT_CALC_',
            supabaseUrl: configService.get<string>('PRINT_CALC_SUPABASE_URL') || '',
            supabaseServiceRoleKey: configService.get<string>('PRINT_CALC_SUPABASE_SECRET_KEY') || '',
            capabilities: {
                hasDynamicRoles: true,
                hasSubApps: true,
                hasWelcomeCredits: true,
                hasSmsDeliveryTracking: true,
                hasAiDailyLimit: true,
            },
        },
    ];
};
