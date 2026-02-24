import { IsString, IsNumber, IsOptional, ValidateNested, IsBoolean, IsArray, IsEmail } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { BillingDetailsDto, PurchaseItemDto } from '../../purchases/dto/purchase.dto';

export class PaystackCheckoutPayloadDto {
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

  @ApiProperty()
  @IsBoolean()
  isExistingOrg: boolean;

  @ApiProperty({ required: false })
  @IsOptional()
  appProvisioningDetails?: Record<string, any>;
}

export class PaystackInitializeDto {
  @ApiProperty()
  @IsNumber()
  amount: number;

  @ApiProperty()
  @IsEmail()
  email: string;

  @ApiProperty()
  @IsString()
  customerPhoneNumber: string;

  @ApiProperty()
  @IsString()
  clientReference: string;

  @ApiProperty({ required: false })
  @ValidateNested()
  @Type(() => PaystackCheckoutPayloadDto)
  @IsOptional()
  checkoutPayload?: PaystackCheckoutPayloadDto;
}

export class PaystackCheckoutDto {
  @ApiProperty()
  @IsString()
  reference: string;

  @ApiProperty({ required: false })
  @ValidateNested()
  @Type(() => PaystackCheckoutPayloadDto)
  @IsOptional()
  checkoutPayload?: PaystackCheckoutPayloadDto;

  @ApiProperty({ required: false })
  @IsOptional()
  paymentResponse?: Record<string, any>;
}
