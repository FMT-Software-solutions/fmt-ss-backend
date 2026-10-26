import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ResendService } from '../../common/resend/resend.service';
import { ArkeselService } from '../../common/arkesel/arkesel.service';
import { normalizeGhanaPhoneNumber } from '../../common/utils/phone.utils';
import { parseEmailList } from '../../common/utils/email.utils';

const FROM = 'FMT Software Solutions <purchase@fmtsoftware.com>';

export interface PlanContactInfo {
  contact: string;
  contact_type: 'email' | 'phone';
  billing_details?: { organizationEmail?: string; phoneNumber?: string } | null;
}

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export const ghs = (n: number) =>
  `GHS ${Number(n).toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Email and SMS for payment plans. Sends to every channel we have for the
 * customer: the contact they asked with, plus the email and phone they gave
 * when accepting. Failures are logged, never thrown, so a down SMS gateway
 * can't undo a payment.
 */
@Injectable()
export class PlanNotificationsService {
  private readonly logger = new Logger(PlanNotificationsService.name);

  constructor(
    private readonly resend: ResendService,
    private readonly arkesel: ArkeselService,
    private readonly config: ConfigService,
  ) { }

  private get sender() {
    return this.config.get<string>('SMS_ALERT_SENDER_ID') || 'FMTSoftware';
  }

  channels(plan: PlanContactInfo) {
    const emails = new Set<string>();
    const phones = new Set<string>();
    if (plan.contact_type === 'email') emails.add(plan.contact.toLowerCase());
    else phones.add(plan.contact);
    const billingEmail = plan.billing_details?.organizationEmail;
    if (billingEmail) emails.add(billingEmail.toLowerCase());
    const billingPhone = normalizeGhanaPhoneNumber(plan.billing_details?.phoneNumber);
    if (billingPhone) phones.add(billingPhone);
    return { emails: [...emails], phones: [...phones] };
  }

  async email(to: string[], subject: string, paragraphs: string[], action?: { label: string; url: string }) {
    if (!to.length) return false;
    const html = `
      <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#111">
        ${paragraphs.map((p) => `<p style="font-size:15px;line-height:1.5">${p}</p>`).join('')}
        ${action ? `<p style="margin:28px 0"><a href="${action.url}" style="background:#e11d48;color:#fff;padding:12px 22px;border-radius:6px;text-decoration:none;font-weight:600">${escapeHtml(action.label)}</a></p>` : ''}
        <p style="font-size:13px;color:#666">FMT Software Solutions</p>
      </div>`;
    try {
      const { error } = await this.resend.sendEmail({ from: FROM, to, subject, html });
      if (error) throw new Error(error.message);
      return true;
    } catch (error) {
      this.logger.warn(`Plan email "${subject}" failed: ${(error as Error).message}`);
      return false;
    }
  }

  async sms(to: string[], message: string) {
    if (!to.length) return false;
    // Sandbox (for local testing): Arkesel accepts the request but delivers nothing.
    const sandbox = this.config.get<string>('PAYMENT_PLAN_SMS_SANDBOX') === 'true';
    try {
      await this.arkesel.sendStandardSms(this.sender, message, to, sandbox || undefined);
      if (sandbox) this.logger.log(`[sandbox SMS to ${to.join(', ')}] ${message}`);
      return true;
    } catch (error) {
      this.logger.warn(`Plan SMS failed: ${(error as Error).message}`);
      return false;
    }
  }

  /** Same message by email and SMS; returns which channels went out. */
  async notify(
    plan: PlanContactInfo,
    message: { subject: string; paragraphs: string[]; sms: string; action?: { label: string; url: string } },
  ) {
    const { emails, phones } = this.channels(plan);
    const [email, sms] = await Promise.all([
      this.email(emails, message.subject, message.paragraphs, message.action),
      this.sms(phones, message.sms),
    ]);
    return { email, sms };
  }

  async notifyAdmins(subject: string, paragraphs: string[], action?: { label: string; url: string }) {
    const admins = parseEmailList(this.config.get('ADMIN_EMAILS'));
    return this.email(admins.length ? admins : ['fmtsoftwaresolutions@gmail.com'], subject, paragraphs, action);
  }

  html = escapeHtml;
}
