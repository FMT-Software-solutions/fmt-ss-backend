import { IsISO8601, IsOptional, IsString, IsUUID } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SendAlertDto {
  @ApiProperty()
  @IsString()
  appId: string;

  @ApiProperty()
  @IsUUID()
  organizationId: string;
}

export class UsageQueryDto {
  @ApiPropertyOptional({ description: 'ISO date; defaults to 30 days ago' })
  @IsISO8601()
  @IsOptional()
  from?: string;

  @ApiPropertyOptional({ description: 'ISO date; defaults to now' })
  @IsISO8601()
  @IsOptional()
  to?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  appId?: string;
}
