import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsEmail, IsIn, IsOptional, IsString, Matches, MaxLength, ValidateNested } from 'class-validator';
import { BillingDetailsDto } from '../../purchases/dto/purchase.dto';

/**
 * Starts a website order. Only the products and the buyer are taken from the
 * browser; prices, totals and the payment reference are set by the server.
 */
export class CreateStoreOrderDto {
  @ApiProperty({ type: [String], description: 'Sanity premiumApp ids' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @IsString({ each: true })
  productIds: string[];

  @ApiProperty({ type: BillingDetailsDto })
  @ValidateNested()
  @Type(() => BillingDetailsDto)
  billingDetails: BillingDetailsDto;

  @ApiProperty({ enum: ['paystack', 'hubtel'] })
  @IsIn(['paystack', 'hubtel'])
  provider: 'paystack' | 'hubtel';

  @ApiPropertyOptional()
  @IsString()
  @MaxLength(40)
  @IsOptional()
  discountCode?: string;
}

/** Prices an order (and checks a discount code) without creating it. */
export class QuoteStoreOrderDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @IsString({ each: true })
  productIds: string[];

  @ApiPropertyOptional()
  @IsString()
  @MaxLength(40)
  @IsOptional()
  discountCode?: string;

  @ApiPropertyOptional({ description: 'Buyer email, for per-customer code limits' })
  @IsEmail()
  @IsOptional()
  email?: string;
}

export class ConfirmStoreOrderDto {
  @ApiProperty()
  @IsString()
  @Matches(/^FMT[A-Z0-9]{8,40}$/, { message: 'Invalid order reference' })
  reference: string;
}
