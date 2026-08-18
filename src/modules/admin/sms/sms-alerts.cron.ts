import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { AdminSmsService } from './admin-sms.service';

/**
 * Daily low-balance sweep.
 *
 * Runs once each morning rather than continuously: a balance warning is only
 * actionable during working hours, and messaging customers repeatedly about
 * the same low balance is worse than not messaging at all. Per-organization
 * cooldowns are enforced in AdminSmsService.getAlertCandidates().
 *
 * Disabled unless SMS_ALERTS_ENABLED is 'true', so a developer running the
 * backend locally never texts real customers.
 */
@Injectable()
export class SmsAlertsCron {
  private readonly logger = new Logger(SmsAlertsCron.name);

  constructor(
    private readonly smsService: AdminSmsService,
    private readonly configService: ConfigService,
  ) { }

  private get enabled(): boolean {
    return this.configService.get<string>('SMS_ALERTS_ENABLED') === 'true';
  }

  @Cron('0 7 * * *', { name: 'sms-low-balance-sweep', timeZone: 'Africa/Accra' })
  async sweep() {
    if (!this.enabled) {
      this.logger.log('SMS alert sweep skipped (SMS_ALERTS_ENABLED is not "true")');
      return;
    }

    this.logger.log('Starting the SMS low-balance sweep');

    const { candidates } = await this.smsService.getAlertCandidates();
    const toAlert = candidates.filter((candidate) => candidate.wouldAlert);

    let sent = 0;
    let failed = 0;

    for (const candidate of toAlert) {
      try {
        await this.smsService.sendLowBalanceAlert(
          candidate.appId,
          candidate.organizationId,
          undefined,
          'cron',
        );
        sent += 1;
      } catch (error) {
        failed += 1;
        this.logger.warn(
          `Alert failed for ${candidate.organizationName ?? candidate.organizationId}: ${
            error instanceof Error ? error.message : 'Unknown error'
          }`,
        );
      }
    }

    const skipped = candidates.length - toAlert.length;
    this.logger.log(
      `SMS sweep finished: ${sent} sent, ${failed} failed, ${skipped} skipped (cooldown or no phone number)`,
    );

    // Separately, warn the team when FMT's own wallet cannot cover what
    // organizations are holding.
    const overview = await this.smsService.getOverview();
    const walletLow =
      overview.mainBalance.available &&
      (overview.mainBalance.low || (overview.shortfall ?? 0) > 0);

    if (walletLow) {
      const result = await this.smsService.sendMainBalanceWarning(overview);
      this.logger.warn(
        `Arkesel wallet warning emailed (success=${result.succeeded}): ${overview.mainBalance.smsBalance} SMS vs ${overview.totalOrgCredits} credits outstanding`,
      );
    }
  }
}
