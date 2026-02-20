import { IsString, IsNotEmpty, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UnsubscribeDto {
    @ApiProperty({ example: 'uuid-token', description: 'The unsubscribe token' })
    @IsString()
    @IsNotEmpty()
    token: string;
}
