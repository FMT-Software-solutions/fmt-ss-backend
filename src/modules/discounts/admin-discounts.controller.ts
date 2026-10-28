import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { User } from '@supabase/supabase-js';
import { AdminAuthGuard } from '../../common/auth/admin-auth.guard';
import { CurrentAdmin } from '../../common/auth/current-admin.decorator';
import { DiscountsService } from './discounts.service';
import { DiscountCodeInputDto, UpdateDiscountCodeDto } from './dto/discount-code.dto';

@ApiTags('Admin: discount codes')
@ApiBearerAuth()
@UseGuards(AdminAuthGuard)
@Controller('admin/discount-codes')
export class AdminDiscountsController {
  constructor(private readonly discounts: DiscountsService) { }

  @Get()
  list(@Query() query: { page?: number; limit?: number; search?: string; status?: string }) {
    return this.discounts.list(query);
  }

  @Post()
  create(@Body() dto: DiscountCodeInputDto, @CurrentAdmin() admin: User) {
    return this.discounts.create(dto, admin);
  }

  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateDiscountCodeDto) {
    return this.discounts.update(id, dto);
  }
}
