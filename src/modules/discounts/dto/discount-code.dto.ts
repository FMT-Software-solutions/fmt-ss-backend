import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

export class DiscountCodeInputDto {
  @ApiProperty({ example: 'LAUNCH20' })
  @Matches(/^[A-Za-z0-9_-]{2,40}$/, { message: 'Codes use letters, numbers, - and _ (2–40)' })
  code: string;

  @ApiPropertyOptional()
  @IsString()
  @MaxLength(200)
  @IsOptional()
  description?: string;

  @ApiProperty({ enum: ['percent', 'fixed'] })
  @IsIn(['percent', 'fixed'])
  valueType: 'percent' | 'fixed';

  @ApiProperty()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  value: number;

  @ApiPropertyOptional({ type: [String], description: 'Sanity premiumApp ids; empty = every app' })
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @IsOptional()
  appIds?: string[];

  @ApiPropertyOptional({ nullable: true })
  @ValidateIf((_, v) => v !== null)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @IsOptional()
  minTotal?: number | null;

  @ApiPropertyOptional({ nullable: true })
  @ValidateIf((_, v) => v !== null)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @IsOptional()
  maxDiscount?: number | null;

  @ApiPropertyOptional({ nullable: true })
  @ValidateIf((_, v) => v !== null)
  @IsISO8601()
  @IsOptional()
  startsAt?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @ValidateIf((_, v) => v !== null)
  @IsISO8601()
  @IsOptional()
  endsAt?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @ValidateIf((_, v) => v !== null)
  @IsInt()
  @Min(1)
  @IsOptional()
  maxUses?: number | null;

  @ApiPropertyOptional({ default: 1 })
  @IsInt()
  @Min(1)
  @IsOptional()
  perCustomerLimit?: number;

  @ApiPropertyOptional({ default: false })
  @IsBoolean()
  @IsOptional()
  firstPurchaseOnly?: boolean;

  @ApiPropertyOptional({ default: true })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}

export class UpdateDiscountCodeDto extends PartialType(DiscountCodeInputDto) { }
