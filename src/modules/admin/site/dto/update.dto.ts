import { IsBoolean, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateMessageDto {
  @ApiPropertyOptional({ description: 'Mark the message read or unread' })
  @IsBoolean()
  @IsOptional()
  read?: boolean;

  @ApiPropertyOptional({ description: 'Archive or restore the message' })
  @IsBoolean()
  @IsOptional()
  archived?: boolean;
}

const QUOTE_STATUSES = [
  'requested',
  'confirmed',
  'reviewing',
  'pending-customer-feedback',
  'completed',
  'cancelled',
];

export class UpdateQuoteDto {
  @ApiPropertyOptional({ enum: QUOTE_STATUSES })
  @IsIn(QUOTE_STATUSES)
  status: string;
}

export class UpdateReviewDto {
  @ApiPropertyOptional({ enum: ['pending', 'approved', 'rejected'] })
  @IsIn(['pending', 'approved', 'rejected'])
  @IsOptional()
  status?: string;

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  is_featured?: boolean;
}

export class UpdateIssueDto {
  @ApiPropertyOptional({ enum: ['open', 'investigating', 'resolved', 'ignored'] })
  @IsIn(['open', 'investigating', 'resolved', 'ignored'])
  @IsOptional()
  status?: string;

  @ApiPropertyOptional()
  @IsString()
  @MaxLength(2000)
  @IsOptional()
  resolution_notes?: string;
}
