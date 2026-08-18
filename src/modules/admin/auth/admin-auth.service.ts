import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../../../common/supabase/supabase.service';
import { ResendService } from '../../../common/resend/resend.service';
import { buildOtpEmail } from './otp-email.template';

// Progressive cooldown, same scheme as the product apps' send-otp edge
// function: 4 requests max per window, then an admin has to intervene.
const MAX_REQUESTS = 4;
const WINDOW_RESET_HOURS = 24;

const GENERIC_RESPONSE = {
  success: true,
  message:
    'If an admin account exists for this email, a verification code has been sent.',
};

function cooldownMinutes(requestCount: number): number {
  if (requestCount <= 0) return 0;
  if (requestCount === 1) return 1;
  if (requestCount === 2) return 3;
  return 5;
}

@Injectable()
export class AdminAuthService {
  private readonly logger = new Logger(AdminAuthService.name);

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly resendService: ResendService,
  ) { }

  // Rate limiting is tracked for every requested email, existing account or
  // not, so the responses and limits never reveal whether an account exists.
  async forgotPassword(email: string) {
    const supabase = this.supabaseService.getServiceRoleClient();

    const { data: tracker } = await supabase
      .from('admin_otp_requests')
      .select('email, requests_count, last_request_at')
      .eq('email', email)
      .maybeSingle();

    const now = new Date();
    let requestCount = tracker?.requests_count ?? 0;

    if (tracker?.last_request_at) {
      const lastRequest = new Date(tracker.last_request_at);
      const hoursSince = (now.getTime() - lastRequest.getTime()) / 3_600_000;

      if (hoursSince >= WINDOW_RESET_HOURS) {
        requestCount = 0;
      } else {
        if (requestCount >= MAX_REQUESTS) {
          throw new HttpException(
            'Maximum verification code requests exceeded. Please try again later or contact the team.',
            HttpStatus.TOO_MANY_REQUESTS,
          );
        }

        const requiredCooldown = cooldownMinutes(requestCount);
        const minutesSince = hoursSince * 60;
        if (minutesSince < requiredCooldown) {
          const wait = Math.ceil(requiredCooldown - minutesSince);
          throw new HttpException(
            `Please wait ${wait} minute${wait > 1 ? 's' : ''} before requesting another code.`,
            HttpStatus.TOO_MANY_REQUESTS,
          );
        }
      }
    }

    const { error: upsertError } = await supabase
      .from('admin_otp_requests')
      .upsert({
        email,
        requests_count: requestCount + 1,
        last_request_at: now.toISOString(),
      });

    if (upsertError) {
      // Almost always means the admin_otp_requests table is missing — see
      // supabase_migrations/20260817_admin_auth.sql. The request still
      // proceeds, but per-email cooldowns are inert until that table exists.
      const detail = upsertError.message || upsertError.code
        ? `${upsertError.message ?? ''}${upsertError.code ? ` [${upsertError.code}]` : ''}`
        : 'table missing or unreachable — run supabase_migrations/20260817_admin_auth.sql';
      this.logger.error(
        `Could not record OTP request, per-email rate limiting is INACTIVE: ${detail}`,
      );
    }

    // generateLink creates the OTP without sending Supabase's own email.
    const { data, error } = await supabase.auth.admin.generateLink({
      type: 'recovery',
      email,
    });

    if (error || !data?.properties?.email_otp) {
      // Unknown email lands here — same response as success.
      return GENERIC_RESPONSE;
    }

    if (data.user?.app_metadata?.fmt_admin !== true) {
      this.logger.warn(`OTP requested for non-admin account: ${email}`);
      return GENERIC_RESPONSE;
    }

    const firstName = (data.user.user_metadata?.first_name as string) || '';
    const lastName = (data.user.user_metadata?.last_name as string) || '';
    const userName = `${firstName} ${lastName}`.trim() || email;

    const template = buildOtpEmail(data.properties.email_otp, userName);
    const { error: emailError } = await this.resendService.sendEmail({
      from: 'FMT Software <auth@fmtsoftware.com>',
      to: [email],
      subject: template.subject,
      html: template.html,
      text: template.text,
    });

    if (emailError) {
      this.logger.error(`Failed to send OTP email: ${JSON.stringify(emailError)}`);
      throw new HttpException(
        'Failed to send verification email. Please try again.',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    return GENERIC_RESPONSE;
  }
}
