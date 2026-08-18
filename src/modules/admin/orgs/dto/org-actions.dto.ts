import {
  IsBoolean,
  IsEmail,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  NotEquals,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** Trims strings so whitespace-only input fails validation rather than the database. */
const trim = () =>
  Transform(({ value }) => (typeof value === 'string' ? value.trim() : value));

/** Empty string means "unset" for optional text columns. */
const trimToNull = () =>
  Transform(({ value }) => {
    if (typeof value !== 'string') return value;
    const trimmed = value.trim();
    return trimmed.length ? trimmed : null;
  });

export class AdjustCreditsDto {
  @ApiProperty({
    description: 'Credits to add (positive) or remove (negative)',
    example: 100,
  })
  @IsInt()
  @NotEquals(0)
  @Min(-100000)
  @Max(100000)
  delta: number;

  @ApiProperty({ description: 'Why this adjustment is being made' })
  @trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  reason: string;
}

export class UpdateOrganizationDto {
  @ApiPropertyOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  @IsOptional()
  name?: string;

  @ApiPropertyOptional()
  @IsEmail()
  @IsOptional()
  email?: string;

  @ApiPropertyOptional()
  @IsString()
  @MaxLength(50)
  @IsOptional()
  phone?: string;

  @ApiPropertyOptional()
  @IsString()
  @MaxLength(500)
  @IsOptional()
  address?: string;

  @ApiPropertyOptional({ description: 'Suspend or restore the organization' })
  @IsBoolean()
  @IsOptional()
  is_active?: boolean;

  @ApiPropertyOptional({ description: 'Mark the organization as having purchased' })
  @IsBoolean()
  @IsOptional()
  has_purchased?: boolean;

  @ApiPropertyOptional({ description: 'Trial end date (ISO 8601), or null to clear' })
  @IsISO8601()
  @IsOptional()
  trial_end_date?: string | null;

  @ApiPropertyOptional({
    description: 'Arkesel sender ID used for this organization; empty clears it',
    nullable: true,
  })
  @trimToNull()
  @IsString()
  @MaxLength(11)
  @IsOptional()
  sms_sender_id?: string | null;

  @ApiPropertyOptional({ description: 'Daily AI request cap (apps that support it)' })
  @IsInt()
  @Min(0)
  @Max(100000)
  @IsOptional()
  ai_daily_limit?: number;
}

export class UpdateMemberDto {
  @ApiProperty({ description: 'Whether the member can access the organization' })
  @IsBoolean()
  is_active: boolean;
}
