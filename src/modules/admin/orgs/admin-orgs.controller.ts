import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { User } from '@supabase/supabase-js';
import { AdminAuthGuard } from '../../../common/auth/admin-auth.guard';
import { CurrentAdmin } from '../../../common/auth/current-admin.decorator';
import { AdminOrgsService } from './admin-orgs.service';
import { AdminAuditService } from '../audit/admin-audit.service';
import { OrgListQueryDto } from './dto/orgs-query.dto';
import {
  AdjustCreditsDto,
  UpdateMemberDto,
  UpdateOrganizationDto,
} from './dto/org-actions.dto';

@ApiTags('Admin — Organizations')
@ApiBearerAuth()
@UseGuards(AdminAuthGuard)
@Controller('admin')
export class AdminOrgsController {
  constructor(
    private readonly orgsService: AdminOrgsService,
    private readonly auditService: AdminAuditService,
  ) { }

  @Get('apps/registry')
  @ApiOperation({ summary: 'Product apps and what their schemas support' })
  getRegistry() {
    return this.orgsService.getRegistry();
  }

  @Get('apps/summary')
  @ApiOperation({ summary: 'Organization, user and SMS counts per app' })
  getSummary() {
    return this.orgsService.getSummary();
  }

  @Get('organizations')
  @ApiOperation({ summary: 'Billing organizations from the main project' })
  listMainOrganizations(@Query() query: OrgListQueryDto) {
    return this.orgsService.listMainOrganizations(query);
  }

  @Get('apps/:appId/organizations')
  @ApiOperation({ summary: 'Organizations onboarded onto an app' })
  listOrganizations(@Param('appId') appId: string, @Query() query: OrgListQueryDto) {
    return this.orgsService.listOrganizations(appId, query);
  }

  @Get('apps/:appId/organizations/:orgId')
  @ApiOperation({ summary: 'Organization detail with branches, SMS balance and sub-apps' })
  getOrganization(
    @Param('appId') appId: string,
    @Param('orgId', ParseUUIDPipe) orgId: string,
  ) {
    return this.orgsService.getOrganization(appId, orgId);
  }

  @Get('apps/:appId/organizations/:orgId/users')
  @ApiOperation({ summary: 'Members of an organization' })
  listUsers(@Param('appId') appId: string, @Param('orgId', ParseUUIDPipe) orgId: string) {
    return this.orgsService.listOrganizationUsers(appId, orgId);
  }

  @Get('apps/:appId/organizations/:orgId/roles')
  @ApiOperation({ summary: 'Roles for an organization (dynamic or static per app)' })
  listRoles(@Param('appId') appId: string, @Param('orgId', ParseUUIDPipe) orgId: string) {
    return this.orgsService.listOrganizationRoles(appId, orgId);
  }

  @Get('audit')
  @ApiOperation({ summary: 'Recent admin actions, optionally scoped to an organization' })
  listAudit(
    @Query('appId') appId?: string,
    @Query('organizationId') organizationId?: string,
    @Query('limit') limit?: string,
  ) {
    return this.auditService.list({
      appId,
      organizationId,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Post('apps/:appId/organizations/:orgId/sms-credits')
  @ApiOperation({ summary: 'Grant or remove SMS credits with a recorded reason' })
  adjustCredits(
    @Param('appId') appId: string,
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Body() body: AdjustCreditsDto,
    @CurrentAdmin() admin: User,
  ) {
    return this.orgsService.adjustSmsCredits(appId, orgId, body.delta, body.reason, admin);
  }

  @Patch('apps/:appId/organizations/:orgId')
  @ApiOperation({ summary: 'Update organization settings, status and trial' })
  updateOrganization(
    @Param('appId') appId: string,
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Body() body: UpdateOrganizationDto,
    @CurrentAdmin() admin: User,
  ) {
    return this.orgsService.updateOrganization(appId, orgId, { ...body }, admin);
  }

  @Patch('apps/:appId/organizations/:orgId/users/:membershipId')
  @ApiOperation({ summary: 'Activate or deactivate a member' })
  updateMember(
    @Param('appId') appId: string,
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('membershipId', ParseUUIDPipe) membershipId: string,
    @Body() body: UpdateMemberDto,
    @CurrentAdmin() admin: User,
  ) {
    return this.orgsService.updateMember(appId, orgId, membershipId, body.is_active, admin);
  }
}
