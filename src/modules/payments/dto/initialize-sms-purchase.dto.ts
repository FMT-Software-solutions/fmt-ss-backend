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

  @ApiProperty()
  @IsNumber()
  @IsNotEmpty()
  creditsPurchased: number;
}