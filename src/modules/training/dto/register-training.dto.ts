import { IsEmail, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RegisterTrainingDto {
  @ApiProperty({ example: 'web-development-bootcamp', description: 'The slug of the training program' })
  @IsString()
  @IsNotEmpty()
  trainingSlug: string;

  @ApiProperty({ example: 'John', description: 'First Name' })
  @IsString()
  @IsNotEmpty()
  firstName: string;

  @ApiProperty({ example: 'Doe', description: 'Last Name' })
  @IsString()
  @IsNotEmpty()
  lastName: string;

  @ApiProperty({ example: 'john@example.com', description: 'Email address' })
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @ApiProperty({ example: '+1234567890', description: 'Phone number' })
  @IsString()
  @IsNotEmpty()
  phone: string;

  @ApiProperty({ example: 'Acme Inc.', description: 'Company name', required: false })
  @IsString()
  @IsOptional()
  company?: string;

  @ApiProperty({ example: 'I want to learn React', description: 'Message or expectations', required: false })
  @IsString()
  @IsOptional()
  message?: string;
}
