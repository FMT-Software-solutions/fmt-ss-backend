import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { User } from '@supabase/supabase-js';
import { AdminAuthGuard } from '../../common/auth/admin-auth.guard';
import { CurrentAdmin } from '../../common/auth/current-admin.decorator';
import { PaymentPlansService } from './payment-plans.service';
import { PlanJobsService } from './plan-jobs.service';
import {
  CreatePlanDto,
  PlanStatusActionDto,
  RecordManualPaymentDto,
  SendPlanLinkDto,
  UpdatePlanRequestDto,
} from './dto/payment-plans.dto';

@ApiTags('Admin: payment plans')
@ApiBearerAuth()
@UseGuards(AdminAuthGuard)
@Controller('admin/payment-plans')
export class AdminPaymentPlansController {
  constructor(
    private readonly plans: PaymentPlansService,
    private readonly jobs: PlanJobsService,
  ) { }

  @Get('summary')
  summary() {
    return this.plans.summary();
  }

  @Get('requests')
  listRequests(@Query() query: { page?: number; limit?: number; status?: string; search?: string }) {
    return this.plans.listRequests(query);
  }

  @Patch('requests/:id')
  updateRequest(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdatePlanRequestDto) {
    return this.plans.updateRequest(id, dto.status);
  }

  @Get('quote/:appId')
  @ApiOperation({ summary: 'Current price of an app (promotion included)' })
  quote(@Param('appId') appId: string) {
    return this.plans.quote(appId);
  }

  @Get()
  list(@Query() query: { page?: number; limit?: number; status?: string; search?: string }) {
    return this.plans.listPlans(query);
  }

  @Post()
  create(@Body() dto: CreatePlanDto, @CurrentAdmin() admin: User) {
    return this.plans.createPlan(dto, admin);
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.plans.adminPlan(id);
  }

  @Post(':id/send')
  @ApiOperation({ summary: 'Send (or copy) the plan link' })
  send(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SendPlanLinkDto, @CurrentAdmin() admin: User) {
    return this.plans.sendLink(id, dto.via, admin);
  }

  @Post(':id/payments')
  @ApiOperation({ summary: 'Record a cash/bank payment' })
  recordPayment(@Param('id', ParseUUIDPipe) id: string, @Body() dto: RecordManualPaymentDto, @CurrentAdmin() admin: User) {
    return this.plans.recordManualPayment(id, dto, admin);
  }

  @Post(':id/status')
  @ApiOperation({ summary: 'Suspend, reinstate or cancel' })
  changeStatus(@Param('id', ParseUUIDPipe) id: string, @Body() dto: PlanStatusActionDto, @CurrentAdmin() admin: User) {
    return this.plans.changeStatus(id, dto.action, dto.reason, admin);
  }

  @Post('jobs/run')
  @ApiOperation({ summary: 'Run the reminder and grace-period sweep now' })
  runJobs() {
    return this.jobs.sweep();
  }
}
