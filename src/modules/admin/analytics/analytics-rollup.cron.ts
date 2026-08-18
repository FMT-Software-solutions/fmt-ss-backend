import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { AdminAnalyticsService } from './admin-analytics.service';

/**
 * Nightly rollup. Yesterday's raw page views are aggregated into
 * analytics_daily, then rows past the retention window are dropped — history
 * survives in the rollup while the raw table, which holds the visitor hashes,
 * stays small and short-lived.
 */
@Injectable()
export class AnalyticsRollupCron {
  private readonly logger = new Logger(AnalyticsRollupCron.name);

  constructor(private readonly analyticsService: AdminAnalyticsService) { }

  @Cron('30 2 * * *', { name: 'analytics-rollup', timeZone: 'Africa/Accra' })
  async rollup() {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);

    try {
      const { paths, views } = await this.analyticsService.rollupDay(yesterday);
      this.logger.log(
        `Analytics rollup for ${yesterday.toISOString().slice(0, 10)}: ${views} views across ${paths} paths`,
      );
    } catch (error) {
      // A missing table simply means the migration has not been run yet.
      const message = error instanceof Error ? error.message : 'Unknown error';
      if (/could not find the table|does not exist/i.test(message)) {
        this.logger.warn('Analytics tables are missing; skipping the rollup');
        return;
      }
      this.logger.error(`Analytics rollup failed: ${message}`);
      return;
    }

    try {
      const purged = await this.analyticsService.purgeOldRows();
      if (purged) {
        this.logger.log(
          `Purged ${purged} page views older than ${this.analyticsService.retentionDays} days`,
        );
      }
    } catch (error) {
      this.logger.error(
        `Analytics purge failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }
}
