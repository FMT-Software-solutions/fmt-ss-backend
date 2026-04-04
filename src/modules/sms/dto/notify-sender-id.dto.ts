import { IsString, IsNotEmpty, IsOptional, IsIn } from 'class-validator';

export class NotifySenderIdDto {
    @IsString()
    @IsNotEmpty()
    organizationName: string;

    @IsString()
    @IsNotEmpty()
    senderId: string;

    @IsString()
    @IsNotEmpty()
    reason: string;

    @IsString()
  @IsOptional()
  @IsIn(['created', 'resubmitted'])
  action?: 'created' | 'resubmitted';

  @IsString()
  @IsOptional()
  appId?: string;

  @IsString()
  @IsOptional()
  appName?: string;
}
