import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ArkeselService } from '../../common/arkesel/arkesel.service';
import { ResendService } from '../../common/resend/resend.service';
import { SendSmsRequestDto } from './dto/send-sms.dto';
import { NotifySenderIdDto } from './dto/notify-sender-id.dto';
import { normalizeGhanaPhoneNumber } from '../../common/utils/phone.utils';

@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name);

  constructor(
    private readonly arkeselService: ArkeselService,
    private readonly resendService: ResendService,
    private readonly configService: ConfigService,
  ) { }

  async sendSms(dto: SendSmsRequestDto) {
    if (!dto.recipients || dto.recipients.length === 0) {
      throw new BadRequestException('At least one recipient is required');
    }

    const hasVariables = /\{([^}]+)\}/.test(dto.message);

    // Normalize phone numbers and filter out invalid ones
    const normalizedRecipients = dto.recipients
      .map(recipient => ({
        ...recipient,
        phone: normalizeGhanaPhoneNumber(recipient.phone)
      }))
      .filter(recipient => recipient.phone !== null);

    // Remove duplicates based on phone number
    const uniquePhones = new Set<string>();
    const validRecipients = normalizedRecipients.filter(recipient => {
      if (uniquePhones.has(recipient.phone!)) {
        return false;
      }
      uniquePhones.add(recipient.phone!);
      return true;
    });

    if (validRecipients.length === 0) {
      throw new BadRequestException('No valid Ghana phone numbers found in recipients');
    }

    if (hasVariables) {
      // 1. Convert message variables from {var} to <%var%> for Arkesel
      const parsedMessage = dto.message.replace(/\{([^}]+)\}/g, '<%$1%>');

      // 2. Format recipients to a single object dictionary for Arkesel Template API
      // Dynamically attach all properties sent from the frontend to Arkesel
      const arkeselTemplateRecipients = validRecipients.reduce((acc, recipient) => {
        const { phone, ...otherFields } = recipient;
        acc[phone!] = { ...otherFields };
        return acc;
      }, {} as Record<string, Record<string, string>>);

      if (dto.scheduledDate) {
        return this.arkeselService.scheduleTemplateSms(dto.sender, parsedMessage, arkeselTemplateRecipients, dto.scheduledDate, dto.sandbox);
      }
      return this.arkeselService.sendTemplateSms(dto.sender, parsedMessage, arkeselTemplateRecipients, dto.sandbox, dto.callbackUrl);
    } else {
      // Standard SMS - just an array of phone numbers
      const phoneNumbersOnly = validRecipients.map(r => r.phone);

      if (dto.scheduledDate) {
        return this.arkeselService.scheduleStandardSms(dto.sender, dto.message, phoneNumbersOnly as string[], dto.scheduledDate, dto.sandbox);
      }
      return this.arkeselService.sendStandardSms(dto.sender, dto.message, phoneNumbersOnly as string[], dto.sandbox, dto.callbackUrl);
    }
  }

  async checkBalance() {
    return this.arkeselService.checkBalance();
  }

  async getSmsDetails(smsId: string) {
    if (!smsId) {
      throw new BadRequestException('SMS ID is required');
    }
    return this.arkeselService.getSmsDetails(smsId);
  }

  async notifySenderIdRequest(dto: NotifySenderIdDto) {
    const adminEmailsString = this.configService.get<string>('ADMIN_EMAILS');
    if (!adminEmailsString) {
      this.logger.warn('ADMIN_EMAILS not configured, skipping sender ID notification');
      return { success: false, message: 'Admin emails not configured' };
    }

    const adminEmails = adminEmailsString.split(',').map(e => e.trim()).filter(e => e.length > 0);

    if (adminEmails.length === 0) {
      return { success: false, message: 'No valid admin emails found' };
    }

    const actionText = dto.action === 'resubmitted' ? 'resubmitted a rejected' : 'requested a new';
    const subject = `[ChurchHub360] Sender ID Request: ${dto.senderId}`;

    const htmlContent = `
      <h2>Sender ID Request</h2>
      <p>Organization <strong>${dto.organizationName}</strong> has ${actionText} Sender ID.</p>
      <p><strong>Sender ID:</strong> ${dto.senderId}</p>
      <p><strong>Reason:</strong><br/>${dto.reason}</p>
      <hr/>
      <p>Please review and approve/reject this request</p>
    `;

    try {
      await this.resendService.sendEmail({
        from: 'ChurchHub360 <noreply@fmtsoftware.com>', // Use verified domain if needed, or fallback
        to: adminEmails,
        subject,
        html: htmlContent,
      });
      return { success: true, message: 'Notification sent' };
    } catch (error) {
      this.logger.error('Failed to send Sender ID notification', error);
      // Don't throw to avoid breaking the frontend flow if email fails
      return { success: false, message: 'Failed to send notification' };
    }
  }
}

