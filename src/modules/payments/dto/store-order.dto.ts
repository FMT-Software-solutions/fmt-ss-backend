import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsString, Matches, ValidateNested } from 'class-validator';
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
}

export class ConfirmStoreOrderDto {
  @ApiProperty()
  @IsString()
  @Matches(/^FMT[A-Z0-9]{8,40}$/, { message: 'Invalid order reference' })
  reference: string;
}
