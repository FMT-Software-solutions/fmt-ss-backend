// Branded OTP email, adapted from the product apps' send-otp edge function
// (stock-flow/supabase/functions/send-otp/index.ts).

const COLORS = {
  primary: '#4F46E5',
  foreground: '#0F172A',
  muted: '#64748B',
};

export function buildOtpEmail(otp: string, userName: string) {
  const organizationName = 'FMT Software Solutions';

  return {
    subject: 'Your admin verification code',
    html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Verification Code - ${organizationName}</title>
</head>
<body style="font-family: Arial, sans-serif; background-color: #f6f9fc; margin: 0; padding: 20px;">
  <div style="max-width: 600px; margin: 0 auto; background-color: white; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
    <div style="padding: 32px 24px 24px; border-bottom: 1px solid #f0f0f0;">
      <h1 style="margin: 0; font-size: 24px; color: ${COLORS.foreground};">${organizationName}</h1>
      <h2 style="margin: 16px 0 0 0; font-size: 20px; color: ${COLORS.foreground};">Admin Password Reset</h2>
    </div>
    <div style="padding: 32px 24px;">
      <p style="margin: 0 0 16px 0; font-size: 16px; line-height: 1.6; color: ${COLORS.foreground};">Hi ${userName},</p>
      <p style="margin: 0 0 24px 0; font-size: 16px; line-height: 1.6; color: ${COLORS.foreground};">
        A password reset was requested for your admin account. Use the code below to continue:
      </p>
      <div style="background-color: #f3f4f6; border: 2px dashed #d1d5db; border-radius: 8px; padding: 24px; margin: 24px 0; text-align: center;">
        <p style="margin: 0 0 8px 0; font-size: 14px; color: ${COLORS.muted};">Your verification code:</p>
        <p style="margin: 0; font-size: 32px; font-weight: bold; letter-spacing: 0.1em; color: ${COLORS.primary}; font-family: monospace;">
          ${otp}
        </p>
      </div>
      <p style="margin: 0 0 16px 0; font-size: 14px; color: ${COLORS.muted};">
        This code will expire in 1 hour.
      </p>
      <p style="margin: 0 0 16px 0; font-size: 16px; line-height: 1.6; color: ${COLORS.foreground};">
        If you didn't request this code, please ignore this email or contact the team if you have concerns.
      </p>
      <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;">
      <p style="margin: 0; font-size: 14px; color: ${COLORS.muted};">
        For security reasons, never share this code with anyone.
      </p>
    </div>
    <div style="padding: 24px; border-top: 1px solid #f0f0f0; background-color: #f8fafc; text-align: center;">
      <p style="margin: 0; font-size: 12px; color: ${COLORS.muted};">© ${new Date().getFullYear()} ${organizationName}. All rights reserved.</p>
    </div>
  </div>
</body>
</html>
`,
    text: `
Admin Password Reset

Hi ${userName},

A password reset was requested for your admin account. Use this code to proceed:

Verification Code: ${otp}

Security Notice:
- This code expires in 1 hour
- Never share this code with anyone
- If you didn't request this, please ignore this email
`,
  };
}
