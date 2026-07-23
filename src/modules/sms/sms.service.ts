import { Injectable, Logger, BadRequestException, HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ArkeselService } from '../../common/arkesel/arkesel.service';
import { ResendService } from '../../common/resend/resend.service';
import { AppsService } from '../apps/apps.service';
import { SendSmsRequestDto } from './dto/send-sms.dto';
import { NotifySenderIdDto } from './dto/notify-sender-id.dto';
import { normalizeGhanaPhoneNumber } from '../../common/utils/phone.utils';
import { calculateTotalSmsCost } from './utils/sms-calculator.util';

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

    // EXACT COST CALCULATION
    const totalCost = calculateTotalSmsCost(dto.message, validRecipients, hasVariables);
    let supabase: any = null;

    if (dto.organizationId && dto.appId) {
      // PRE-FLIGHT CHECK: Ensure organization has enough credits for the total calculated cost
      supabase = this.appsService.getSupabaseClient(dto.appId);
      const { data: orgBalance, error: balanceError } = await supabase
        .from('organization_sms_balances')
        .select('credit_balance')
        .eq('organization_id', dto.organizationId)
        .single();

      if (balanceError || !orgBalance) {
        throw new BadRequestException('Could not verify organization SMS balance');
      }

      if (orgBalance.credit_balance < totalCost) {
        throw new HttpException(`Insufficient SMS credits. Required: ${totalCost}, Available: ${orgBalance.credit_balance}`, HttpStatus.PAYMENT_REQUIRED);
      }
    }

    // Request an Arkesel delivery webhook when the caller passed a history row id
    // and we have a public URL to receive the callback. Optional — skipped for
    // callers/apps that don't opt in.
    const publicApiUrl = this.configService.get<string>('PUBLIC_API_URL');
    let callbackUrl: string | undefined;
    if (dto.messageRef && publicApiUrl && dto.appId) {
      callbackUrl =
        `${publicApiUrl.replace(/\/$/, '')}/api/sms/webhook/arkesel` +
        `?ref=${encodeURIComponent(dto.messageRef)}&app_id=${encodeURIComponent(dto.appId)}`;
    }

    let sendResult;

    if (hasVariables) {
      // Extract all expected variables from the message string (e.g., {first_name} -> first_name)
      const expectedVariables = [...dto.message.matchAll(/\{([^}]+)\}/g)].map(match => match[1]);

      // 1. Convert message variables from {var} to <%var%> for Arkesel
      const parsedMessage = dto.message.replace(/\{([^}]+)\}/g, '<%$1%>');

      // 2. Format recipients to a single object dictionary for Arkesel Template API
      const arkeselTemplateRecipients = validRecipients.reduce((acc, recipient) => {
        const { phone, ...otherFields } = recipient;

        // Ensure all expected variables exist on the recipient to prevent Arkesel validation errors
        const safeVariables: Record<string, string> = {};
        expectedVariables.forEach(variable => {
          // If the variable is phone, grab it directly from recipient since we destructured it out of otherFields
          if (variable === 'phone') {
            safeVariables[variable] = phone as string;
            return;
          }

          // Cast otherFields to any to bypass TS indexing error since otherFields type is inferred as unknown
          const value = (otherFields as any)[variable];
          safeVariables[variable] = (value !== undefined && value !== null) ? String(value) : '';
        });

        acc[phone!] = safeVariables;
        return acc;
      }, {} as Record<string, Record<string, string>>);

      if (dto.scheduledDate) {
        sendResult = await this.arkeselService.scheduleTemplateSms(dto.sender, parsedMessage, arkeselTemplateRecipients, dto.scheduledDate, dto.sandbox);
      } else {
        sendResult = await this.arkeselService.sendTemplateSms(dto.sender, parsedMessage, arkeselTemplateRecipients, dto.sandbox, callbackUrl);
      }
    } else {
      // Standard SMS - just an array of phone numbers (strings)
      const phoneNumbersOnly = validRecipients.map(r => r.phone as string);

      if (dto.scheduledDate) {
        sendResult = await this.arkeselService.scheduleStandardSms(dto.sender, dto.message, phoneNumbersOnly, dto.scheduledDate, dto.sandbox);
      } else {
        sendResult = await this.arkeselService.sendStandardSms(dto.sender, dto.message, phoneNumbersOnly, dto.sandbox, callbackUrl);
      }
    }

    // Only deduct once Arkesel confirms it accepted the message. A non-'success'
    // body (bad sender ID, blacklisted numbers, provider error) must NOT be
    // charged — fetchApi already throws on HTTP errors, this guards the
    // body-level error case (HTTP 200 with status !== 'success').
    const providerSucceeded = !!sendResult && sendResult.status === 'success';
    if (!providerSucceeded) {
      this.logger.error(
        `Arkesel did not confirm success for org ${dto.organizationId}: ${JSON.stringify(sendResult)}`,
      );
      throw new HttpException(
        'The SMS provider did not accept the message. No credits were deducted.',
        HttpStatus.BAD_GATEWAY,
      );
    }

    // SYNCHRONOUS CREDIT DEDUCTION (only after confirmed provider success)
    if (supabase && dto.organizationId) {
      try {
        const recipientDesc = validRecipients.length === 1 ? validRecipients[0].phone : `Bulk (${validRecipients.length} recipients)`;
        const { data, error } = await supabase.rpc('deduct_sms_credits', {
          p_org_id: dto.organizationId,
          p_message_count: totalCost,
          p_recipient: recipientDesc,
          p_payload: { message: dto.message, totalCost, recipientsCount: validRecipients.length, isTemplate: hasVariables }
        });

        if (error) {
          this.logger.error(`RPC error deducting SMS balance for organization: ${dto.organizationId} synchronously`, error);
        } else {
          this.logger.log(`Synchronous deduction successful. Org: ${dto.organizationId}. Used: ${data?.usage_deducted}, Bonus: ${data?.bonus_applied}, New Balance: ${data?.new_balance}.`);
        }
      } catch (err) {
        this.logger.error(`Unexpected error executing RPC deduct_sms_credits for org: ${dto.organizationId}`, err);
      }
    }

    return sendResult;
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

  /**
   * Arkesel delivery-report webhook. Updates the linked communication_history row
   * (via `ref`) from 'sent' to 'delivered'/'failed'. Always acks 200 so Arkesel
   * doesn't retry-storm; parses defensively since the DLR body shape can vary.
   */
  async handleDeliveryWebhook(ref: string | undefined, appId: string | undefined, body: any) {
    try {
      if (!ref || !appId) {
        this.logger.warn('Delivery webhook missing ref or app_id; acknowledging without update');
        return { received: true };
      }

      const supabase = this.appsService.getSupabaseClient(appId);
      const reports = Array.isArray(body) ? body : [body];

      for (const report of reports) {
        if (!report || typeof report !== 'object') continue;
        const recipient =
          report.recipient ?? report.phone_number ?? report.phone ?? report.to ?? null;
        const rawStatus = report.status ?? report.delivery_status ?? report.state ?? '';
        const status = String(rawStatus).toUpperCase();
        if (!status) continue;

        const { error } = await supabase.rpc('record_sms_delivery', {
          p_ref: ref,
          p_recipient: recipient ? String(recipient) : null,
          p_status: status,
        });
        if (error) {
          this.logger.error(`record_sms_delivery failed for ref ${ref}: ${error.message}`);
        }
      }

      return { received: true };
    } catch (err) {
      this.logger.error(`Error handling delivery webhook for ref ${ref}`, err as Error);
      return { received: true };
    }
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
    const appName = dto.appName || dto.appId || 'FMT Software Solutions';
    const subject = `[${appName}] Sender ID Request: ${dto.senderId}`;

    const htmlContent = `
      <h2>Sender ID Request</h2>
      <p>Organization <strong>${dto.organizationName}</strong> has ${actionText} Sender ID for the app <strong>${appName}</strong>.</p>
      <p><strong>Sender ID:</strong> ${dto.senderId}</p>
      <p><strong>Reason:</strong><br/>${dto.reason}</p>
      <hr/>
      <p>Please review and approve/reject this request</p>
    `;

    try {
      await this.resendService.sendEmail({
        from: 'FMT Software Solutions <noreply@fmtsoftware.com>', // Use verified domain if needed, or fallback
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

