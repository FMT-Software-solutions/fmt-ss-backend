import { Injectable, Logger, BadRequestException, HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ArkeselService } from '../../common/arkesel/arkesel.service';
import { ResendService } from '../../common/resend/resend.service';
import { AppsService } from '../apps/apps.service';
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
    private readonly appsService: AppsService,
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

    if (dto.organizationId && dto.appId) {
      // PRE-FLIGHT CHECK: Ensure organization has enough credits for minimum 1 part per recipient
      const supabase = this.appsService.getSupabaseClient(dto.appId);
      const { data: orgBalance, error: balanceError } = await supabase
        .from('organization_sms_balances')
        .select('credit_balance')
        .eq('organization_id', dto.organizationId)
        .single();

      if (balanceError || !orgBalance) {
        throw new BadRequestException('Could not verify organization SMS balance');
      }

      if (orgBalance.credit_balance < validRecipients.length) {
        throw new HttpException(`Insufficient SMS credits. Required: ${validRecipients.length}, Available: ${orgBalance.credit_balance}`, HttpStatus.PAYMENT_REQUIRED);
      }
    }

    // Attach webhook URL if organization is provided
    let finalCallbackUrl = dto.callbackUrl;
    if (dto.organizationId && dto.appId) {
      const apiUrl = this.configService.get<string>('PUBLIC_API_URL') || 'https://api.fmtsoftware.com';
      finalCallbackUrl = `${apiUrl}/api/sms/webhook/arkesel?orgId=${dto.organizationId}&appId=${dto.appId}`;
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
      return this.arkeselService.sendTemplateSms(dto.sender, parsedMessage, arkeselTemplateRecipients, dto.sandbox, finalCallbackUrl);
    } else {
      // Standard SMS - just an array of phone numbers
      const phoneNumbersOnly = validRecipients.map(r => r.phone);

      if (dto.scheduledDate) {
        return this.arkeselService.scheduleStandardSms(dto.sender, dto.message, phoneNumbersOnly as string[], dto.scheduledDate, dto.sandbox);
      }
      return this.arkeselService.sendStandardSms(dto.sender, dto.message, phoneNumbersOnly as string[], dto.sandbox, finalCallbackUrl);
    }
  }

  async handleArkeselWebhook(payload: any, orgId: string, appId: string) {
    this.logger.log(`Received Arkesel webhook payload: ${JSON.stringify(payload)}`);
    if (!orgId || !appId) {
      this.logger.warn('Arkesel webhook received without an organization ID or App ID in the query params.');
      return;
    }

    // Usually the payload from Arkesel has an ID, recipient, status, and message_count.
    const { id, recipient, status, message_count } = payload;

    if (status !== 'DELIVERED' && status !== 'SENT') {
      // Depending on requirements, we might only deduct for SENT/DELIVERED,
      // but usually the provider charges upon submission unless failed immediately.
      // Assuming Arkesel charges for any processed message, we proceed for "SENT" or "DELIVERED".
      // Adjust if Arkesel payload uses different keys or you want to deduct even for failures.
    }

    const messageCount = Number(message_count) || 1; // Fallback to 1 if not provided

    const supabase = this.appsService.getSupabaseClient(appId);

    try {
      // Use the RPC to safely deduct credits and record transactions atomically
      const { data, error } = await supabase.rpc('deduct_sms_credits', {
        p_org_id: orgId,
        p_message_count: messageCount,
        p_recipient: recipient,
        p_payload: payload
      });

      if (error) {
        this.logger.error(`RPC error deducting SMS balance for organization: ${orgId}`, error);
        return;
      }

      this.logger.log(`Webhook processed for SMS ${id} to ${recipient}. Org: ${orgId}. Used: ${data?.usage_deducted}, Bonus: ${data?.bonus_applied}, New Balance: ${data?.new_balance}.`);
    } catch (err) {
      this.logger.error(`Unexpected error executing RPC deduct_sms_credits for org: ${orgId}`, err);
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

