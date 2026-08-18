import { Body, Controller, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { Request } from 'express';
import { AnalyticsService } from './analytics.service';
import { CollectDto } from './dto/collect.dto';

@ApiTags('Analytics')
@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) { }

  /**
   * Public ingest for the marketing site's beacon. Returns 204 immediately —
   * the browser sends this with sendBeacon and never reads the response.
   */
  @Post('collect')
  @HttpCode(204)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 40, ttl: 60000 } })
  @ApiOperation({ summary: 'Record a page view' })
  async collect(@Body() body: CollectDto, @Req() request: Request): Promise<void> {
    await this.analyticsService.collect(body, request);
  }
}
