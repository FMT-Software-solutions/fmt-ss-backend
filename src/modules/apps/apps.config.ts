import { ConfigService } from '@nestjs/config';

export interface AppConfig {
    id: string; // The unique app ID (e.g. 'church-hub-360')
    name: string; // Display name
    slug: string;
    description: string;
    supabaseUrl: string;
    supabaseServiceRoleKey: string;
    envPrefix: string; // Prefix for env variables, e.g. 'CHURCH_HUB_'
}

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
        },
    ];
};