import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { BillingDetailsDto } from '../../purchases/dto/purchase.dto';

// ---------------------------------------------------------------- public

export class CreatePlanRequestDto {
  @ApiProperty({ description: 'Sanity premiumApp id' })
  @IsString()
  @MaxLength(100)
  appId: string;

  @ApiProperty({ description: 'Email address or Ghana phone number' })
  @IsString()
  @MinLength(5)
  @MaxLength(120)
  contact: string;

  @ApiPropertyOptional()
  @IsString()
  @MaxLength(120)
  @IsOptional()
  name?: string;

  @ApiPropertyOptional()
  @IsString()
  @MaxLength(160)
  @IsOptional()
  organizationName?: string;

  @ApiPropertyOptional()
  @IsString()
  @MaxLength(1000)
  @IsOptional()
  message?: string;
}

export class VerifyPlanCodeDto {
  @ApiProperty()
  @Matches(/^\d{6}$/, { message: 'Enter the 6-digit code' })
  code: string;
}

export class AcceptPlanDto {
  @ApiProperty({ type: BillingDetailsDto })
  @ValidateNested()
  @Type(() => BillingDetailsDto)
  billingDetails: BillingDetailsDto;
}

export class PayPlanDto {
  @ApiProperty({ description: 'GHS; at least what is due now (the deposit first time), at most the balance' })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  amount: number;

  @ApiProperty({ enum: ['paystack', 'hubtel'] })
  @IsIn(['paystack', 'hubtel'])
  provider: 'paystack' | 'hubtel';
}

export class PlanPaymentRefDto {
  @ApiProperty()
  @Matches(/^FMP[A-Z0-9]{8,40}$/, { message: 'Invalid payment reference' })
  reference: string;
}

// ---------------------------------------------------------------- admin

export class ScheduleRowDto {
  @IsInt()
  @Min(0)
  seq: number;

  @IsISO8601({ strict: true })
  due_date: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  amount: number;
}

export class CreatePlanDto {
  @ApiPropertyOptional({ description: 'Request this plan answers' })
  @IsUUID()
  @IsOptional()
  requestId?: string;

  @ApiProperty()
  @IsString()
  appId: string;

  @ApiProperty({ description: 'Email address or Ghana phone number' })
  @IsString()
  @MinLength(5)
  @MaxLength(120)
  contact: string;

  @ApiPropertyOptional()
  @IsString()
  @MaxLength(120)
  @IsOptional()
  customerName?: string;

  @ApiPropertyOptional()
  @IsString()
  @MaxLength(160)
  @IsOptional()
  organizationName?: string;

  @ApiPropertyOptional({ description: 'Defaults to the current price (promotion included)' })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  @IsOptional()
  basePrice?: number;

  @ApiPropertyOptional({ default: 0 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  @IsOptional()
  surchargePercent?: number;

  @ApiProperty()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  deposit: number;

  @ApiProperty({ description: 'Instalments after the deposit' })
  @IsInt()
  @Min(0)
  @Max(36)
  count: number;

  @ApiProperty({ enum: ['weekly', 'biweekly', 'monthly'] })
  @IsIn(['weekly', 'biweekly', 'monthly'])
  frequency: 'weekly' | 'biweekly' | 'monthly';

  @ApiPropertyOptional({ description: 'Hand-edited schedule; replaces deposit/count/frequency' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(37)
  @ValidateNested({ each: true })
  @Type(() => ScheduleRowDto)
  @IsOptional()
  schedule?: ScheduleRowDto[];

  @ApiPropertyOptional({ default: 7 })
  @IsInt()
  @Min(0)
  @Max(60)
  @IsOptional()
  graceDays?: number;

  @ApiPropertyOptional()
  @IsString()
  @MaxLength(2000)
  @IsOptional()
  notes?: string;
}

export class SendPlanLinkDto {
  @ApiPropertyOptional({ description: 'Defaults to the plan contact channel', enum: ['email', 'sms', 'both', 'none'] })
  @IsIn(['email', 'sms', 'both', 'none'])
  @IsOptional()
  via?: 'email' | 'sms' | 'both' | 'none';
}

export class RecordManualPaymentDto {
  @ApiProperty()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  amount: number;

  @ApiPropertyOptional({ description: 'cash, bank, momo…' })
  @IsString()
  @MaxLength(40)
  @IsOptional()
  method?: string;

  @ApiPropertyOptional()
  @IsString()
  @MaxLength(500)
  @IsOptional()
  note?: string;

  @ApiPropertyOptional({ type: BillingDetailsDto, description: 'Needed for the first payment if the customer never accepted online' })
  @ValidateNested()
  @Type(() => BillingDetailsDto)
  @IsOptional()
  billingDetails?: BillingDetailsDto;
}

export class UpdatePlanRequestDto {
  @ApiProperty({ enum: ['new', 'planned', 'declined'] })
  @IsIn(['new', 'planned', 'declined'])
  status: 'new' | 'planned' | 'declined';
}

export class PlanStatusActionDto {
  @ApiProperty({ enum: ['suspend', 'reinstate', 'cancel'] })
  @IsIn(['suspend', 'reinstate', 'cancel'])
  action: 'suspend' | 'reinstate' | 'cancel';

  @ApiPropertyOptional()
  @IsString()
  @MaxLength(500)
  @IsOptional()
  reason?: string;
}
