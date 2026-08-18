import { Body, Controller, Get, HttpCode, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { User } from '@supabase/supabase-js';
import { AdminAuthGuard } from '../../../common/auth/admin-auth.guard';
import { CurrentAdmin } from '../../../common/auth/current-admin.decorator';
import { AdminProvisioningService } from './admin-provisioning.service';
import { PaginationQueryDto } from '../dto/pagination.dto';
import {
  CreateProvisioningPurchaseDto,
  PreflightDto,
  RunProvisioningDto,
  SendConfirmationDto,
} from './dto/provisioning.dto';

@ApiTags('Admin — Provisioning')
@ApiBearerAuth()
@UseGuards(AdminAuthGuard)
@Controller('admin/provisioning')
export class AdminProvisioningController {
  constructor(private readonly provisioningService: AdminProvisioningService) { }

  @Get('apps')
  @ApiOperation({ summary: 'Purchasable apps and whether each can be provisioned' })
  listApps() {
    return this.provisioningService.listApps();
  }

  @Get('history')
  @ApiOperation({ summary: 'Manual purchases created from the admin console' })
  listHistory(@Query() query: PaginationQueryDto) {
    return this.provisioningService.listHistory(query);
  }

  @Post('preflight')
  @HttpCode(200)
  @ApiOperation({ summary: 'Check what already exists before onboarding' })
  preflight(@Body() body: PreflightDto) {
    return this.provisioningService.preflight(body.email, body.productIds, body.ownerEmail);
  }

  @Post('purchase')
  @ApiOperation({ summary: 'Create the organization and its manual purchase record' })
  createPurchase(
    @Body() body: CreateProvisioningPurchaseDto,
    @CurrentAdmin() admin: User,
  ) {
    return this.provisioningService.createPurchase(body, admin);
  }

  @Post('run')
  @ApiOperation({ summary: 'Provision the selected apps for an organization' })
  run(@Body() body: RunProvisioningDto, @CurrentAdmin() admin: User) {
    return this.provisioningService.runProvisioning(body, admin);
  }

  @Post('confirmation-email')
  @ApiOperation({ summary: 'Send the purchase confirmation email' })
  sendConfirmation(@Body() body: SendConfirmationDto, @CurrentAdmin() admin: User) {
    return this.provisioningService.sendConfirmationEmail(body, admin);
  }
}
