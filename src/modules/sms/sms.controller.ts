import { Controller, Post, Get, Body, Param, Query } from '@nestjs/common';
import { SmsService } from './sms.service';
import { SendSmsRequestDto } from './dto/send-sms.dto';
import { NotifySenderIdDto } from './dto/notify-sender-id.dto';
import { ApiTags, ApiOperation } from '@nestjs/swagger';

@ApiTags('sms')
@Controller('sms')
export class SmsController {
  constructor(private readonly smsService: SmsService) { }

  @Post('webhook/arkesel')
  @ApiOperation({ summary: 'Receive delivery reports from Arkesel' })
  async handleArkeselWebhook(@Body() payload: any, @Query('orgId') orgId: string, @Query('appId') appId: string) {
    return this.smsService.handleArkeselWebhook(payload, orgId, appId);
  }

  @Post('send')
  @ApiOperation({ summary: 'Send SMS (automatically detects if it needs Arkesel standard or template API)' })
  async sendSms(@Body() dto: SendSmsRequestDto) {
    return this.smsService.sendSms(dto);
  }

  @Get('balance')
  @ApiOperation({ summary: 'Check Arkesel SMS balance' })
  async checkBalance() {
    return this.smsService.checkBalance();
  }

  @Get('details/:id')
  @ApiOperation({ summary: 'Get details of a sent SMS' })
  async getSmsDetails(@Param('id') id: string) {
    return this.smsService.getSmsDetails(id);
  }

  @Post('sender-id/notify')
  @ApiOperation({ summary: 'Send email notification to admins for sender ID requests' })
  async notifySenderIdRequest(@Body() dto: NotifySenderIdDto) {
    return this.smsService.notifySenderIdRequest(dto);
  }
}
