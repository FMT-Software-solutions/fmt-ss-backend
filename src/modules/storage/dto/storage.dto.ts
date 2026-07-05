import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class UploadFileDto {
  @ApiProperty({ description: 'App identifier (e.g. print-calc-pro)' })
  @IsString()
  @IsNotEmpty()
  appId: string;

  @ApiProperty({ description: 'Organization the file belongs to' })
  @IsString()
  @IsNotEmpty()
  organizationId: string;

  @ApiProperty({ required: false, description: "Logical grouping, e.g. 'job_artwork'" })
  @IsString()
  @IsOptional()
  scope?: string;
}

export class FileActionDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  appId: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  organizationId: string;
}
