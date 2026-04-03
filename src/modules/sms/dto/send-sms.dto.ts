import { IsString, IsArray, IsOptional, MaxLength, IsBoolean, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class SmsRecipientDto {
  @IsString()
  phone: string;

  // Allow any other dynamic properties (name, first_name, email, etc.)
  [key: string]: any;
}

export class SendSmsRequestDto {
  @IsString()
  @MaxLength(11, { message: 'Sender ID must be at most 11 characters' })
  sender: string;

  @IsString()
  message: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SmsRecipientDto)
  recipients: SmsRecipientDto[];

  @IsOptional()
  @IsString()
  scheduledDate?: string;

  @IsOptional()
  @IsBoolean()
  sandbox?: boolean;

  @IsOptional()
  @IsString()
  organizationId?: string;

  @IsOptional()
  @IsString()
  appId?: string;

  @IsOptional()
  @IsString()
  callbackUrl?: string;
}
