import { IsString, IsEmail, IsOptional, IsNumber, IsBoolean, ValidateNested, IsArray, IsEnum } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export class AddressDto {
  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  street?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  city?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  state?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  country?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  postalCode?: string;
}

export class BillingDetailsDto {
  @ApiProperty()
  @IsString()
  organizationName: string;

  @ApiProperty()
  @IsEmail()
  organizationEmail: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  firstName?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  lastName?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  phoneNumber?: string;

  @ApiProperty({ required: false })
  @ValidateNested()
  @Type(() => AddressDto)
  @IsOptional()
  address?: AddressDto;
}

export class PurchaseItemDto {
  @ApiProperty()
  @IsString()
  productId: string;

  @ApiProperty()
  @IsNumber()
  quantity: number;

  @ApiProperty({ required: false })
  @IsNumber()
  @IsOptional()
  price?: number;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  title?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  product?: any;
}

export class ManualPurchaseDto {
  @ApiProperty()
  @ValidateNested()
  @Type(() => BillingDetailsDto)
  billingDetails: BillingDetailsDto;

  @ApiProperty({ type: [PurchaseItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PurchaseItemDto)
  items: PurchaseItemDto[];

  @ApiProperty()
  @IsNumber()
  total: number;

  @ApiProperty({ required: false })
  @IsBoolean()
  @IsOptional()
  isExistingOrg?: boolean;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  clientReference?: string;

  @ApiProperty({ enum: ['pending', 'completed', 'failed'], required: false })
  @IsEnum(['pending', 'completed', 'failed'])
  @IsOptional()
  status?: 'pending' | 'completed' | 'failed';
}

export class GeneralPurchaseDto {
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
  total: number;

  @ApiProperty()
  @IsString()
  payment_reference: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  paymentDetails?: any;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  paymentProvider?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  paymentMethod?: string;
}

export class ConfirmationEmailDto {
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
  total: number;
}

export class AppProvisioningDto {
  @ApiProperty()
  @IsString()
  organizationId: string;

  @ApiProperty()
  @ValidateNested()
  @Type(() => BillingDetailsDto)
  billingDetails: BillingDetailsDto;

  @ApiProperty()
  @IsOptional()
  appProvisioningDetails: Record<string, any>;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  mode?: 'buy' | 'trial' | 'free';
}

export class TrialRequestDto {
  @ApiProperty()
  @ValidateNested()
  @Type(() => BillingDetailsDto)
  organizationDetails: BillingDetailsDto;

  @ApiProperty()
  @IsString()
  productId: string;
}

export class FreeAccessRequestDto {
  @ApiProperty()
  @ValidateNested()
  @Type(() => BillingDetailsDto)
  organizationDetails: BillingDetailsDto;

  @ApiProperty()
  @IsString()
  productId: string;
}
