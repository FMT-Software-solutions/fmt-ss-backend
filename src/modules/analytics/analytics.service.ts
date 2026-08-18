import { Injectable, Logger } from '@nestjs/common';
import type { Request } from 'express';
import { SupabaseService } from '../../common/supabase/supabase.service';
import type { CollectDto } from './dto/collect.dto';
import {
  classifyUserAgent,
  hashVisitor,
  isBot,
  normalisePath,
  referrerHost,
  resolveClientIp,
  resolveGeo,
} from './visitor.util';

@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);

  constructor(private readonly supabaseService: SupabaseService) { }

  private get db() {
    return this.supabaseService.getServiceRoleClient();
  }

  /**
   * Records a page view. Never throws: a analytics failure must not surface as
   * an error on the visitor's page, and the beacon ignores the response anyway.
   */
  async collect(payload: CollectDto, request: Request): Promise<void> {
    const userAgent = request.headers['user-agent'] ?? null;
    if (isBot(typeof userAgent === 'string' ? userAgent : null)) return;

    const path = normalisePath(payload.path);
    if (!path) return;

    const ip = resolveClientIp(request);
    const { country, region } = resolveGeo(request, ip);
    const { device, browser, os } = classifyUserAgent(
      typeof userAgent === 'string' ? userAgent : null,
    );

    const { error } = await this.db.from('page_views').insert({
      path,
      referrer_host: referrerHost(payload.referrer),
      session_id: payload.sessionId ?? null,
      visitor_hash: hashVisitor(ip, typeof userAgent === 'string' ? userAgent : null),
      country,
      region,
      device,
      browser,
      os,
      utm_source: payload.utmSource ?? null,
      utm_medium: payload.utmMedium ?? null,
      utm_campaign: payload.utmCampaign ?? null,
      screen_w: payload.screenW ?? null,
      lang: payload.lang ?? null,
    });

    if (error) {
      this.logger.warn(
        `Could not record a page view: ${error.message || 'run supabase_migrations/20260817_website_analytics.sql'}`,
      );
    }
  }
}
