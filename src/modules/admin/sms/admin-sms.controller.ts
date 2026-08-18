import { Body, Controller, Get, HttpCode, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { User } from '@supabase/supabase-js';
import { AdminAuthGuard } from '../../../common/auth/admin-auth.guard';
import { CurrentAdmin } from '../../../common/auth/current-admin.decorator';
import { AdminSmsService } from './admin-sms.service';
import { SendAlertDto, UsageQueryDto } from './dto/sms.dto';

@ApiTags('Admin — SMS')
@ApiBearerAuth()
@UseGuards(AdminAuthGuard)
@Controller('admin/sms')
export class AdminSmsController {
  constructor(private readonly smsService: AdminSmsService) { }

  @Get('main-balance')
  @ApiOperation({ summary: "FMT's Arkesel SMS and cash balance" })
  getMainBalance() {
    return this.smsService.getMainBalance();
  }

  @Get('overview')
  @ApiOperation({ summary: 'Arkesel balance versus outstanding organization credits' })
  getOverview() {
    return this.smsService.getOverview();
  }

  @Get('balances')
  @ApiOperation({ summary: 'Every organization credit balance across apps' })
  listBalances() {
    return this.smsService.listBalances();
  }

  @Get('transactions')
  @ApiOperation({ summary: 'Recent credit movements across apps' })
  listTransactions(
    @Query('appId') appId?: string,
    @Query('organizationId') organizationId?: string,
    @Query('limit') limit?: string,
  ) {
    return this.smsService.listTransactions({
      appId,
      organizationId,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Get('usage')
  @ApiOperation({ summary: 'Daily credit usage for charting' })
  getUsage(@Query() query: UsageQueryDto) {
    return this.smsService.getUsage(query);
  }

  @Get('alerts/dry-run')
  @ApiOperation({ summary: 'Which organizations the sweep would warn, without sending' })
  dryRun() {
    return this.smsService.getAlertCandidates();
  }

  @Get('alerts/history')
  @ApiOperation({ summary: 'Previously sent low-balance alerts' })
  history(@Query('limit') limit?: string) {
    return this.smsService.listAlertHistory(limit ? Number(limit) : undefined);
  }

  @Post('alerts/send')
  @HttpCode(200)
  @ApiOperation({ summary: 'Send a low-balance SMS to one organization now' })
  sendAlert(@Body() body: SendAlertDto, @CurrentAdmin() admin: User) {
    return this.smsService.sendLowBalanceAlert(body.appId, body.organizationId, admin, 'admin');
  }
}
