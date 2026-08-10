import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';

export class InitializeSmsPurchaseDto {
  @ApiProperty()
  @IsNumber()
  @IsNotEmpty()
  amountGhs: number;

  @ApiProperty()
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  callbackUrl: string;

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
  appId: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  appName?: string;

  @ApiProperty({
    required: false,
    deprecated: true,
    description:
      'IGNORED. Credits are derived server-side from the amount Paystack confirms was charged (see pricing.ts). Accepted only so existing clients keep working.',
  })
  @IsNumber()
  @IsOptional()
  creditsPurchased?: number;
}