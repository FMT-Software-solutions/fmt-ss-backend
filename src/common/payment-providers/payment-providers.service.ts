import { BadRequestException, Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Talks to Paystack and Hubtel on the server: starts Hubtel hosted checkouts
 * and asks either provider whether a reference was paid, and how much.
 * Used by website orders and payment plans; neither trusts the browser.
 */

export type ProviderConfirmation = {
  paid: boolean;
  amountGhs: number;
  method?: string;
  externalId?: string;
  raw: unknown;
};

/** Hubtel wants 233XXXXXXXXX. */
export const toHubtelMsisdn = (phone?: string) => {
  const digits = (phone ?? '').replace(/\D/g, '');
  if (digits.length === 10 && digits.startsWith('0')) return `233${digits.slice(1)}`;
  if (digits.length === 9) return `233${digits}`;
  return digits || undefined;
};

@Injectable()
export class PaymentProvidersService {
  private readonly logger = new Logger(PaymentProvidersService.name);

  constructor(private readonly configService: ConfigService) { }

  /** Public origin of this API (no trailing /api), for provider callbacks. */
  publicApiOrigin() {
    const url = this.configService.get<string>('PUBLIC_API_URL') || this.configService.get<string>('FRONTEND_URL') || '';
    return url.replace(/\/+$/, '').replace(/\/api$/, '');
  }

  /** The website, for links and return URLs. */
  siteOrigin() {
    return (this.configService.get<string>('FRONTEND_URL') || 'https://fmtsoftware.com').replace(/\/+$/, '');
  }

  async checkPaystack(reference: string): Promise<ProviderConfirmation> {
    const secretKey = this.configService.get<string>('PAYSTACK_SECRET_KEY');
    if (!secretKey) throw new InternalServerErrorException('Paystack is not configured');
    const res = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
      headers: { Authorization: `Bearer ${secretKey}` },
    });
    const body: any = await res.json().catch(() => null);
    const data = body?.data;
    const paid = res.ok && body?.status === true && data?.status === 'success' && (data?.currency ?? 'GHS') === 'GHS';
    return {
      paid,
      amountGhs: paid ? Number(data.amount) / 100 : 0,
      method: data?.channel,
      externalId: data?.id != null ? String(data.id) : undefined,
      raw: data ? { id: data.id, status: data.status, amount: data.amount, currency: data.currency, channel: data.channel, paid_at: data.paid_at } : body,
    };
  }

  private hubtelAuth() {
    const apiId = this.configService.get<string>('HUBTEL_API_ID');
    const apiKey = this.configService.get<string>('HUBTEL_API_KEY');
    const merchant = this.configService.get<string>('HUBTEL_MERCHANT_ACCOUNT');
    if (!apiId || !apiKey || !merchant) throw new InternalServerErrorException('Hubtel is not configured');
    return { basic: Buffer.from(`${apiId}:${apiKey}`).toString('base64'), merchant };
  }

  /** Creates a Hubtel hosted checkout; the browser only gets the page URL. */
  async initiateHubtel(params: {
    reference: string;
    amount: number;
    description: string;
    returnUrl: string;
    cancellationUrl: string;
    payee?: { name?: string; phone?: string; email?: string };
  }) {
    const { basic, merchant } = this.hubtelAuth();
    const res = await fetch('https://payproxyapi.hubtel.com/items/initiate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Basic ${basic}` },
      body: JSON.stringify({
        totalAmount: params.amount,
        description: params.description,
        callbackUrl: `${this.publicApiOrigin()}/api/payments/hubtel/callback`,
        returnUrl: params.returnUrl,
        cancellationUrl: params.cancellationUrl,
        merchantAccountNumber: merchant,
        clientReference: params.reference,
        payeeName: params.payee?.name,
        payeeMobileNumber: toHubtelMsisdn(params.payee?.phone),
        payeeEmail: params.payee?.email,
      }),
    });
    const body: any = await res.json().catch(() => null);
    const url = body?.data?.checkoutDirectUrl || body?.data?.checkoutUrl;
    if (!res.ok || !url) {
      this.logger.error(`Hubtel initiate failed for ${params.reference}: ${res.status} ${JSON.stringify(body)}`);
      throw new BadRequestException('Could not start the Hubtel payment. Please try again or pay with Paystack.');
    }
    return url as string;
  }

  /** Asks Hubtel directly whether a reference was paid. */
  async checkHubtel(reference: string): Promise<ProviderConfirmation> {
    const { basic, merchant } = this.hubtelAuth();
    const res = await fetch(
      `https://rmsc.hubtel.com/v1/merchantaccount/merchants/${merchant}/transactions/status?clientReference=${encodeURIComponent(reference)}`,
      { headers: { Authorization: `Basic ${basic}` } },
    );
    const body: any = await res.json().catch(() => null);
    const data = body?.data ?? body ?? {};
    const status = String(data.status ?? data.Status ?? '').toLowerCase();
    const paid = res.ok && ['paid', 'success', 'successful', 'completed'].includes(status);
    return {
      paid,
      amountGhs: paid ? Number(data.amount ?? data.Amount ?? 0) : 0,
      method: data.paymentMethod ?? data.PaymentMethod,
      externalId: data.transactionId ?? data.externalTransactionId ?? undefined,
      raw: body,
    };
  }

  check(provider: 'paystack' | 'hubtel', reference: string) {
    return provider === 'hubtel' ? this.checkHubtel(reference) : this.checkPaystack(reference);
  }
}
