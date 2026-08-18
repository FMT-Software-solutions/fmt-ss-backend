import { IsISO8601, IsOptional } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class AnalyticsRangeDto {
  @ApiPropertyOptional({ description: 'ISO date; defaults to 30 days ago' })
  @IsISO8601()
  @IsOptional()
  from?: string;

  @ApiPropertyOptional({ description: 'ISO date; defaults to now' })
  @IsISO8601()
  @IsOptional()
  to?: string;
}
