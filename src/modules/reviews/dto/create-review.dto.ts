import { IsString, IsEmail, IsNotEmpty, IsOptional, IsNumber, Min, Max, IsBoolean, IsIn } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateReviewDto {
  @ApiProperty({ description: 'Type of review', enum: ['general', 'app-specific'] })
  @IsString()
  @IsIn(['general', 'app-specific'])
  type: 'general' | 'app-specific';

  @ApiProperty({ description: 'App ID if type is app-specific', required: false })
  @IsOptional()
  @IsString()
  app_id?: string;

  @ApiProperty({ description: 'Rating from 1 to 5', minimum: 1, maximum: 5 })
  @IsNumber()
  @Min(1)
  @Max(5)
  rating: number;

  @ApiProperty({ description: 'Review content' })
  @IsString()
  @IsNotEmpty()
  content: string;

  @ApiProperty({ description: 'Reviewer name' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ description: 'Reviewer email' })
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @ApiProperty({ description: 'Company name', required: false })
  @IsOptional()
  @IsString()
  company?: string;

  @ApiProperty({ description: 'Job position', required: false })
  @IsOptional()
  @IsString()
  position?: string;
}
