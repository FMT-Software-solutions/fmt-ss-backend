import { IsEmail, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SubscribeDto {
  @ApiProperty({ example: 'user@example.com', description: 'The email to subscribe' })
  @IsEmail()
  @IsNotEmpty()
  email: string;
}
