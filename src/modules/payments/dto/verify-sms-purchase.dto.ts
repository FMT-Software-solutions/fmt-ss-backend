import { IsString, IsNumber, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class VerifySmsPurchaseDto {
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
  reference: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  appId: string;

  @ApiProperty()
  @IsNumber()
  amountGhs: number;

  @ApiProperty()
  @IsNumber()
  creditsPurchased: number;
}