import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminAuthGuard } from '../../../common/auth/admin-auth.guard';
import { AdminAnalyticsService } from './admin-analytics.service';
import { AnalyticsRangeDto } from './dto/analytics-range.dto';

@ApiTags('Admin — Analytics')
@ApiBearerAuth()
@UseGuards(AdminAuthGuard)
@Controller('admin/analytics')
export class AdminAnalyticsController {
  constructor(private readonly analyticsService: AdminAnalyticsService) { }

  @Get('report')
  @ApiOperation({
    summary: 'Visitors, pages, countries, referrers and devices for a date range',
  })
  getReport(@Query() query: AnalyticsRangeDto) {
    return this.analyticsService.getReport(query);
  }
}
