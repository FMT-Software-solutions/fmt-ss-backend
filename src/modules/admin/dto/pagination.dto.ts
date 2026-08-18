import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class PaginationQueryDto {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  page = 1;

  @ApiPropertyOptional({ default: 25, maximum: 100 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  @IsOptional()
  limit = 25;

  @ApiPropertyOptional({ description: 'Free-text search across the list’s text columns' })
  @IsString()
  @IsOptional()
  search?: string;

  @ApiPropertyOptional({ description: 'Sort order', example: 'created_at.desc' })
  @IsString()
  @IsOptional()
  sort?: string;
}

export class DateRangeQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'ISO date, inclusive lower bound on created_at' })
  @IsString()
  @IsOptional()
  from?: string;

  @ApiPropertyOptional({ description: 'ISO date, inclusive upper bound on created_at' })
  @IsString()
  @IsOptional()
  to?: string;
}

export class StatusFilterQueryDto extends DateRangeQueryDto {
  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  status?: string;
}

export class MessagesQueryDto extends DateRangeQueryDto {
  @ApiPropertyOptional({ enum: ['unread', 'read', 'archived'] })
  @IsIn(['unread', 'read', 'archived'])
  @IsOptional()
  state?: 'unread' | 'read' | 'archived';
}

export class ReviewsQueryDto extends StatusFilterQueryDto {
  @ApiPropertyOptional({ description: 'Filter to featured reviews only' })
  @IsIn(['true', 'false'])
  @IsOptional()
  featured?: string;

  @ApiPropertyOptional({ enum: ['general', 'app-specific'] })
  @IsIn(['general', 'app-specific'])
  @IsOptional()
  type?: string;
}

export class PurchasesQueryDto extends StatusFilterQueryDto {
  @ApiPropertyOptional({ example: 'paystack' })
  @IsString()
  @IsOptional()
  provider?: string;
}
