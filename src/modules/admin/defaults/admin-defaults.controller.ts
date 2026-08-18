import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { User } from '@supabase/supabase-js';
import { AdminAuthGuard } from '../../../common/auth/admin-auth.guard';
import { CurrentAdmin } from '../../../common/auth/current-admin.decorator';
import { AdminDefaultsService } from './admin-defaults.service';
import { ApplyDefaultsDto, CaptureTemplateDto, UpsertTemplateDto } from './dto/defaults.dto';

@ApiTags('Admin — Defaults')
@ApiBearerAuth()
@UseGuards(AdminAuthGuard)
@Controller('admin/apps/:appId/defaults')
export class AdminDefaultsController {
  constructor(private readonly defaultsService: AdminDefaultsService) { }

  @Get()
  @ApiOperation({ summary: 'Default templates configured for an app' })
  list(@Param('appId') appId: string) {
    return this.defaultsService.listTemplates(appId);
  }

  @Put()
  @ApiOperation({ summary: 'Create or replace a default template' })
  upsert(
    @Param('appId') appId: string,
    @Body() body: UpsertTemplateDto,
    @CurrentAdmin() admin: User,
  ) {
    return this.defaultsService.upsertTemplate(appId, body.kind, body.payload, body.notes, admin);
  }

  @Post('capture')
  @HttpCode(200)
  @ApiOperation({ summary: 'Read current values from a known-good organization' })
  capture(@Param('appId') appId: string, @Body() body: CaptureTemplateDto) {
    return this.defaultsService.captureFromOrganization(appId, body.organizationId, body.kind);
  }

  @Get('check/:orgId')
  @ApiOperation({ summary: 'Report how an organization differs from the templates' })
  check(@Param('appId') appId: string, @Param('orgId', ParseUUIDPipe) orgId: string) {
    return this.defaultsService.checkOrganization(appId, orgId);
  }

  @Post('apply/:orgId')
  @ApiOperation({ summary: 'Apply the templates to an organization' })
  apply(
    @Param('appId') appId: string,
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Body() body: ApplyDefaultsDto,
    @CurrentAdmin() admin: User,
  ) {
    return this.defaultsService.applyToOrganization(appId, orgId, body.kinds, admin);
  }
}
