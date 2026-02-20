import { IsString, IsEmail, IsOptional, IsNumber, IsBoolean, ValidateNested, IsArray, IsEnum } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export class AddressDto {
  @ApiProperty()
  @IsString()
  street: string;

  @ApiProperty()
  @IsString()
  city: string;

  @ApiProperty()
  @IsString()
  state: string;

  @ApiProperty()
  @IsString()
  country: string;

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
  phoneNumber?: string;

  @ApiProperty()
  @ValidateNested()
  @Type(() => AddressDto)
  address: AddressDto;
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
