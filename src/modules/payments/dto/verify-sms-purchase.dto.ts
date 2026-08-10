import { IsString, IsNumber, IsNotEmpty, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class VerifySmsPurchaseDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  organizationId: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  organizationName?: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  userId: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  reference: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  appId: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  appName?: string;

  @ApiProperty({
    required: false,
    deprecated: true,
    description: 'IGNORED. The charged amount is read from Paystack during verification.',
  })
  @IsNumber()
  @IsOptional()
  amountGhs?: number;

  @ApiProperty({
    required: false,
    deprecated: true,
    description:
      'IGNORED. Credits are derived server-side from the verified amount (see pricing.ts). Previously this value was granted verbatim, which let a tampered callback URL mint arbitrary credits.',
  })
  @IsNumber()
  @IsOptional()
  creditsPurchased?: number;
}