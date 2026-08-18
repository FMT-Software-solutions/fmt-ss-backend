import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BillingDetailsDto, PurchaseItemDto } from '../../../purchases/dto/purchase.dto';

export class PreflightDto {
  @ApiProperty({ description: "The organization's email" })
  @IsEmail()
  email: string;

  @ApiPropertyOptional({
    description: "The owner's login email when it differs from the organization's",
  })
  @IsEmail()
  @IsOptional()
  ownerEmail?: string;

  @ApiProperty({ type: [String], description: 'Sanity premiumApp ids' })
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  productIds: string[];
}

export class CreateProvisioningPurchaseDto {
  @ApiProperty()
  @ValidateNested()
  @Type(() => BillingDetailsDto)
  billingDetails: BillingDetailsDto;

  @ApiProperty({ type: [PurchaseItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PurchaseItemDto)
  items: PurchaseItemDto[];

  @ApiProperty()
  @IsNumber()
  @Min(0)
  total: number;

  @ApiPropertyOptional({ description: 'Reuse an existing organization matched by email' })
  @IsBoolean()
  @IsOptional()
  isExistingOrg?: boolean;

  @ApiPropertyOptional()
  @IsString()
  @MaxLength(100)
  @IsOptional()
  clientReference?: string;

  @ApiPropertyOptional({ enum: ['pending', 'completed', 'failed'] })
  @IsEnum(['pending', 'completed', 'failed'])
  @IsOptional()
  status?: 'pending' | 'completed' | 'failed';

  @ApiPropertyOptional({ description: 'Free-text note recorded against the purchase' })
  @IsString()
  @MaxLength(500)
  @IsOptional()
  note?: string;
}

export class ProvisionAppSelectionDto {
  @ApiProperty({ description: 'Sanity premiumApp id' })
  @IsString()
  productId: string;

  @ApiPropertyOptional({ description: 'Owner login email; defaults to the organization email' })
  @IsEmail()
  @IsOptional()
  userEmail?: string;
}

export class RunProvisioningDto {
  @ApiProperty()
  @IsUUID()
  organizationId: string;

  @ApiPropertyOptional({ description: 'Scope the provisioning result to one purchase' })
  @IsUUID()
  @IsOptional()
  purchaseId?: string;

  @ApiProperty()
  @ValidateNested()
  @Type(() => BillingDetailsDto)
  billingDetails: BillingDetailsDto;

  @ApiProperty({ type: [ProvisionAppSelectionDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ProvisionAppSelectionDto)
  apps: ProvisionAppSelectionDto[];

  @ApiPropertyOptional({ enum: ['buy', 'trial', 'free'] })
  @IsEnum(['buy', 'trial', 'free'])
  @IsOptional()
  mode?: 'buy' | 'trial' | 'free';
}

export class SendConfirmationDto {
  @ApiProperty()
  @ValidateNested()
  @Type(() => BillingDetailsDto)
  organizationDetails: BillingDetailsDto;

  @ApiProperty({ type: [PurchaseItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PurchaseItemDto)
  items: PurchaseItemDto[];

  @ApiProperty()
  @IsNumber()
  @Min(0)
  total: number;
}
