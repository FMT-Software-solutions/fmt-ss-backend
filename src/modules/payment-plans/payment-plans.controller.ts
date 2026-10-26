import { Body, Controller, Get, Headers, Param, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ThrottlerGuard } from '@nestjs/throttler';
import { PaymentPlansService } from './payment-plans.service';
import {
  AcceptPlanDto,
  CreatePlanRequestDto,
  PayPlanDto,
  PlanPaymentRefDto,
  VerifyPlanCodeDto,
} from './dto/payment-plans.dto';

/**
 * Customer side of payment plans. The link token finds the plan; everything
 * past the masked summary needs the session issued after the one-time code.
 */
@ApiTags('Payment plans')
@Controller('payment-plans')
@UseGuards(ThrottlerGuard)
export class PaymentPlansController {
  constructor(private readonly plans: PaymentPlansService) { }

  @Post('requests')
  @ApiOperation({ summary: 'Ask to pay for an app in instalments' })
  createRequest(@Body() dto: CreatePlanRequestDto) {
    return this.plans.createRequest(dto);
  }

  @Get('link/:token')
  @ApiOperation({ summary: 'App name and masked contact for a plan link' })
  linkSummary(@Param('token') token: string) {
    return this.plans.linkSummary(token);
  }

  @Post('link/:token/code')
  @ApiOperation({ summary: 'Send a one-time code to the plan contact' })
  sendCode(@Param('token') token: string) {
    return this.plans.sendCode(token);
  }

  @Post('link/:token/verify')
  @ApiOperation({ summary: 'Exchange the code for a short session' })
  verify(@Param('token') token: string, @Body() dto: VerifyPlanCodeDto) {
    return this.plans.verifyCode(token, dto.code);
  }

  @Get('link/:token/plan')
  @ApiOperation({ summary: 'The plan, schedule and payments' })
  plan(@Param('token') token: string, @Headers('x-plan-session') session?: string) {
    return this.plans.customerPlan(token, session);
  }

  @Post('link/:token/accept')
  @ApiOperation({ summary: 'Accept the plan with organization details' })
  accept(@Param('token') token: string, @Body() dto: AcceptPlanDto, @Headers('x-plan-session') session?: string) {
    return this.plans.accept(token, session, dto.billingDetails);
  }

  @Post('link/:token/pay')
  @ApiOperation({ summary: 'Start a payment (server sets the reference)' })
  pay(@Param('token') token: string, @Body() dto: PayPlanDto, @Headers('x-plan-session') session?: string) {
    return this.plans.startPayment(token, session, dto);
  }

  @Get('payments/:reference')
  @ApiOperation({ summary: 'Payment status; re-checks pending payments with the provider' })
  payment(@Param() params: PlanPaymentRefDto) {
    return this.plans.confirmPayment(params.reference);
  }
}
