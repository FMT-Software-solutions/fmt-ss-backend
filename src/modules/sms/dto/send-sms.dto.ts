import { IsString, IsArray, IsOptional, MaxLength, IsBoolean, ValidatorConstraint, ValidatorConstraintInterface, ValidationArguments, registerDecorator, ValidationOptions } from 'class-validator';

@ValidatorConstraint({ name: 'isValidRecipientsArray', async: false })
export class IsValidRecipientsArrayConstraint implements ValidatorConstraintInterface {
  validate(recipients: any, args: ValidationArguments) {
    if (!Array.isArray(recipients)) return false;
    for (const recipient of recipients) {
      if (typeof recipient !== 'object' || recipient === null) return false;
      if (typeof recipient.phone !== 'string') return false;
    }
    return true;
  }

  defaultMessage(args: ValidationArguments) {
    return 'Each recipient must be an object containing a "phone" string property.';
  }
}

export function IsValidRecipientsArray(validationOptions?: ValidationOptions) {
  return function (object: Object, propertyName: string) {
    registerDecorator({
      target: object.constructor,
      propertyName: propertyName,
      options: validationOptions,
      constraints: [],
      validator: IsValidRecipientsArrayConstraint,
    });
  };
}

export class SendSmsRequestDto {
  @IsString()
  @MaxLength(11, { message: 'Sender ID must be at most 11 characters' })
  sender: string;

  @IsString()
  message: string;

  @IsArray()
  @IsValidRecipientsArray()
  recipients: Record<string, any>[];

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
