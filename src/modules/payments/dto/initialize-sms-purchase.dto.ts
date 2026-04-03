import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsNumber, IsString } from 'class-validator';

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

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  userId: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  appId: string;

  @ApiProperty()
  @IsNumber()
  @IsNotEmpty()
  creditsPurchased: number;
}