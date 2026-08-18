import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminAuthController } from './auth/admin-auth.controller';
import { AdminAuthService } from './auth/admin-auth.service';
import { AdminSiteController } from './site/admin-site.controller';
import { AdminSiteService } from './site/admin-site.service';
import { AdminOrgsController } from './orgs/admin-orgs.controller';
import { AdminOrgsService } from './orgs/admin-orgs.service';
import { AdminAuditService } from './audit/admin-audit.service';
import { AdminProvisioningController } from './provisioning/admin-provisioning.controller';
import { AdminProvisioningService } from './provisioning/admin-provisioning.service';
import { AdminDefaultsController } from './defaults/admin-defaults.controller';
import { AdminDefaultsService } from './defaults/admin-defaults.service';
import { AdminSmsController } from './sms/admin-sms.controller';
import { AdminSmsService } from './sms/admin-sms.service';
import { SmsAlertsCron } from './sms/sms-alerts.cron';
import { AdminAnalyticsController } from './analytics/admin-analytics.controller';
import { AdminAnalyticsService } from './analytics/admin-analytics.service';
import { AnalyticsRollupCron } from './analytics/analytics-rollup.cron';
import { PurchasesModule } from '../purchases/purchases.module';
import { IssuesModule } from '../issues/issues.module';
import { ArkeselModule } from '../../common/arkesel/arkesel.module';

@Module({
  // ArkeselModule is not global, unlike the Supabase/Resend/Apps modules.
  imports: [PurchasesModule, IssuesModule, ArkeselModule],
  controllers: [
    AdminController,
    AdminAuthController,
    AdminSiteController,
    AdminOrgsController,
    AdminProvisioningController,
    AdminDefaultsController,
    AdminSmsController,
    AdminAnalyticsController,
  ],
  providers: [
    AdminAuthService,
    AdminSiteService,
    AdminOrgsService,
    AdminAuditService,
    AdminProvisioningService,
    AdminDefaultsService,
    AdminSmsService,
    SmsAlertsCron,
    AdminAnalyticsService,
    AnalyticsRollupCron,
  ],
})
export class AdminModule {}
