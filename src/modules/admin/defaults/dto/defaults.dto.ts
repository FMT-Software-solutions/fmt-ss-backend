import { IsArray, IsIn, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

const KINDS = ['branding', 'roles', 'organization_settings', 'services'] as const;

export class UpsertTemplateDto {
  @ApiProperty({ enum: KINDS })
  @IsIn(KINDS as unknown as string[])
  kind: (typeof KINDS)[number];

  @ApiProperty({ description: 'The default values this app should apply to new organizations' })
  @IsObject()
  payload: Record<string, unknown>;

  @ApiPropertyOptional()
  @IsString()
  @MaxLength(500)
  @IsOptional()
  notes?: string;
}

export class CaptureTemplateDto {
  @ApiProperty({ enum: KINDS })
  @IsIn(KINDS as unknown as string[])
  kind: (typeof KINDS)[number];

  @ApiProperty({ description: 'Organization to read the known-good values from' })
  @IsString()
  organizationId: string;
}

export class ApplyDefaultsDto {
  @ApiPropertyOptional({
    enum: KINDS,
    isArray: true,
    description: 'Which templates to apply; omit for all active ones',
  })
  @IsArray()
  @IsIn(KINDS as unknown as string[], { each: true })
  @IsOptional()
  kinds?: (typeof KINDS)[number][];
}
