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

  @ApiProperty()
  @IsNumber()
  amountGhs: number;

  @ApiProperty()
  @IsNumber()
  creditsPurchased: number;
}