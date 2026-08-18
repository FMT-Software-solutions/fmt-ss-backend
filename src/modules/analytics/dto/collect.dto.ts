import { IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CollectDto {
  @ApiProperty({ description: 'Relative path of the page viewed' })
  @IsString()
  @MaxLength(500)
  path: string;

  @ApiPropertyOptional({ description: 'document.referrer' })
  @IsString()
  @MaxLength(500)
  @IsOptional()
  referrer?: string;

  @ApiPropertyOptional({ description: 'Per-tab session id from sessionStorage' })
  @IsUUID()
  @IsOptional()
  sessionId?: string;

  @ApiPropertyOptional()
  @IsInt()
  @Min(0)
  @Max(20000)
  @IsOptional()
  screenW?: number;

  @ApiPropertyOptional()
  @IsString()
  @MaxLength(20)
  @IsOptional()
  lang?: string;

  @ApiPropertyOptional()
  @IsString()
  @MaxLength(100)
  @IsOptional()
  utmSource?: string;

  @ApiPropertyOptional()
  @IsString()
  @MaxLength(100)
  @IsOptional()
  utmMedium?: string;

  @ApiPropertyOptional()
  @IsString()
  @MaxLength(100)
  @IsOptional()
  utmCampaign?: string;
}
