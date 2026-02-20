import { IsString, IsNumber, IsOptional, ValidateNested, IsBoolean, IsArray } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { BillingDetailsDto, PurchaseItemDto } from '../../purchases/dto/purchase.dto';

export class HubtelCheckoutPayloadDto {
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

export class HubtelCheckoutRequestDto {
  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  clientReference?: string;

  @ApiProperty({ required: false })
  @ValidateNested()
  @Type(() => HubtelCheckoutPayloadDto)
  @IsOptional()
  checkoutPayload?: HubtelCheckoutPayloadDto;

  @ApiProperty({ required: false })
  @IsOptional()
  paymentResponse?: Record<string, any>;
}

export class HubtelConfigRequestDto {
  @ApiProperty()
  @IsNumber()
  amount: number;

  @ApiProperty()
  @IsString()
  purchaseDescription: string;

  @ApiProperty()
  @IsString()
  customerPhoneNumber: string;

  @ApiProperty()
  @IsString()
  clientReference: string;
}

export class HubtelStatusRequestDto {
  @ApiProperty()
  @IsString()
  clientReference: string;
}
