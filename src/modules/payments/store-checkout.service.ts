import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';
import { SupabaseService } from '../../common/supabase/supabase.service';
import { SanityService } from '../../common/sanity/sanity.service';
import { IssuesService } from '../issues/issues.service';
import { PurchasesService } from '../purchases/purchases.service';
import type { BillingDetailsDto } from '../purchases/dto/purchase.dto';
import type { CreateStoreOrderDto } from './dto/store-order.dto';

/**
 * Website (marketplace) orders.
 *
 *   1. createOrder   — the server prices the products from Sanity, issues the
 *                      payment reference and stores a pending purchase.
 *   2. the buyer pays that reference (Paystack popup, or Hubtel's hosted page)
 *   3. confirm*      — the server asks the provider whether the reference was
 *                      paid IN FULL, then fulfils it once.
 *
 * Nothing the browser says about prices, totals, payment status or
 * provisioning targets is trusted. Fulfilment is idempotent: the pending →
 * completed transition is claimed atomically, so the browser, the Paystack
 * webhook, the Hubtel callback and status polling can all race safely.
 */

interface StoreApp {
  _id: string;
  title: string;
  slug?: string;
  price?: number;
  isFree?: boolean | null;
  promotion?: {
    hasPromotion?: boolean;
    discountPrice?: number;
    startDate?: string;
    endDate?: string;
    isActive?: boolean;
  } | null;
}

export interface PricedItem {
  productId: string;
  title: string;
  slug?: string;
  quantity: number;
  price: number;
  originalPrice: number;
  product: { slug?: string; title: string };
}

type ProviderConfirmation = {
  paid: boolean;
  amountGhs: number;
  method?: string;
  externalId?: string;
  raw: unknown;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Hubtel wants 233XXXXXXXXX. */
const toHubtelMsisdn = (phone?: string) => {
  const digits = (phone ?? '').replace(/\D/g, '');
  if (digits.length === 10 && digits.startsWith('0')) return `233${digits.slice(1)}`;
  if (digits.length === 9) return `233${digits}`;
  return digits || undefined;
};

/** A promotion counts only while it is switched on and inside its dates. */
export function effectivePrice(app: StoreApp, now = new Date()): number {
  const price = Number(app.price ?? 0);
  const promo = app.promotion;
  const inWindow =
    (!promo?.startDate || now >= new Date(promo.startDate)) &&
    (!promo?.endDate || now <= new Date(promo.endDate));
  const promoOn =
    !!promo?.hasPromotion &&
    promo.isActive !== false &&
    Number(promo.discountPrice) > 0 &&
    Number(promo.discountPrice) < price &&
    inWindow;
  return round2(promoOn ? Number(promo!.discountPrice) : price);
}

@Injectable()
export class StoreCheckoutService {
  private readonly logger = new Logger(StoreCheckoutService.name);

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly sanityService: SanityService,
    private readonly configService: ConfigService,
    private readonly purchasesService: PurchasesService,
    private readonly issuesService: IssuesService,
  ) { }

  // ---------------------------------------------------------------- pricing

  async priceProducts(productIds: string[]): Promise<{ items: PricedItem[]; total: number }> {
    const ids = [...new Set(productIds)];
    const apps = await this.sanityService.fetch<StoreApp[]>(
      `*[_type == "premiumApp" && _id in $ids && isPublished == true]{
        _id, title, "slug": slug.current, price, isFree, promotion
      }`,
      { ids },
    );
    const byId = new Map(apps.map((a) => [a._id, a]));
    const items = ids.map((id): PricedItem => {
      const app = byId.get(id);
      if (!app) throw new BadRequestException('One of these apps is not available for purchase');
      if (app.isFree) throw new BadRequestException(`${app.title} is free — no purchase needed`);
      const price = effectivePrice(app);
      if (!(price > 0)) throw new BadRequestException(`${app.title} has no price set`);
      return { productId: id, title: app.title, slug: app.slug, quantity: 1, price, originalPrice: round2(Number(app.price ?? price)), product: { slug: app.slug, title: app.title } };
    });
    return { items, total: round2(items.reduce((s, i) => s + i.price, 0)) };
  }

  // ---------------------------------------------------------------- create

  async createOrder(dto: CreateStoreOrderDto) {
    const { items, total } = await this.priceProducts(dto.productIds);
    const billing = dto.billingDetails;

    for (const item of items) {
      const { hasAccess } = await this.purchasesService.checkAppAccess(billing.organizationEmail, item.productId, 'buy');
      if (hasAccess) throw new BadRequestException(`${billing.organizationEmail} already owns ${item.title}`);
    }

    const reference = `FMT${Date.now().toString(36)}${randomBytes(5).toString('hex')}`.toUpperCase();
    const organizationId = await this.purchasesService.ensureOrganizationAndBillingAddress(billing, false);

    await this.purchasesService.createPurchaseRecord({
      organizationId,
      clientReference: reference,
      amount: total,
      status: 'pending',
      items,
      paymentProvider: dto.provider,
      paymentMethod: dto.provider,
      paymentDetails: { source: 'store', billingDetails: billing, createdAt: new Date().toISOString() },
    });

    if (dto.provider === 'paystack') {
      const publicKey = this.configService.get<string>('PAYSTACK_PUBLIC_KEY');
      if (!publicKey) throw new InternalServerErrorException('Paystack is not configured');
      return { provider: 'paystack' as const, reference, amount: total, currency: 'GHS', email: billing.organizationEmail, publicKey, items };
    }

    const checkoutUrl = await this.initiateHubtel(reference, total, items, billing);
    return { provider: 'hubtel' as const, reference, amount: total, currency: 'GHS', checkoutUrl, items };
  }

  // ---------------------------------------------------------------- confirm

  /** Browser return, webhook and polling all end up here for Paystack. */
  async confirmPaystack(reference: string) {
    const confirmation = await this.checkPaystack(reference);
    if (!confirmation.paid) return this.orderStatus(reference);
    return this.fulfil(reference, 'paystack', confirmation);
  }

  /** Hubtel callback, the return page and polling all end up here for Hubtel. */
  async confirmHubtel(reference: string) {
    const confirmation = await this.checkHubtel(reference);
    if (!confirmation.paid) return this.orderStatus(reference);
    return this.fulfil(reference, 'hubtel', confirmation);
  }

  /**
   * What the buyer's order-complete page polls. Pending orders are re-checked
   * with their provider, so a missed webhook or callback still completes.
   */
  async pollOrder(reference: string) {
    const purchase = await this.findPurchase(reference);
    if (!purchase) throw new NotFoundException('Order not found');
    if (purchase.status === 'pending') {
      try {
        return purchase.payment_provider === 'hubtel'
          ? await this.confirmHubtel(reference)
          : await this.confirmPaystack(reference);
      } catch (error) {
        this.logger.warn(`Polling ${reference}: ${(error as Error).message}`);
      }
    }
    return this.orderStatus(reference);
  }

  async isStoreReference(reference: string) {
    const purchase = await this.findPurchase(reference);
    return purchase?.payment_details?.source === 'store';
  }

  // ---------------------------------------------------------------- fulfil

  private async fulfil(reference: string, provider: 'paystack' | 'hubtel', confirmation: ProviderConfirmation) {
    const supabase: any = this.supabaseService.getServiceRoleClient();
    const purchase = await this.findPurchase(reference);
    if (!purchase) throw new NotFoundException('Order not found');
    if (purchase.status === 'completed') return this.orderStatus(reference);

    const expected = Number(purchase.amount);
    if (confirmation.amountGhs + 0.009 < expected) {
      await this.issuesService.logIssue({
        issue_type: 'error',
        severity: 'critical',
        category: 'payment',
        title: 'Store payment smaller than the order total',
        description: `${provider} reference ${reference} paid GHS ${confirmation.amountGhs}, order total GHS ${expected}. Not fulfilled.`,
        organization_id: purchase.organization_id,
        purchase_id: purchase.id,
        metadata: { reference, provider, paid: confirmation.amountGhs, expected },
      });
      await supabase.from('purchases').update({ status: 'underpaid', updated_at: new Date().toISOString() }).eq('id', purchase.id).eq('status', 'pending');
      throw new BadRequestException('The amount paid does not match this order. Our team has been notified.');
    }

    // Claim the order: only one caller moves it from pending to completed.
    const { data: claimed, error: claimError } = await supabase
      .from('purchases')
      .update({
        status: 'completed',
        payment_method: confirmation.method || provider,
        external_transaction_id: confirmation.externalId ?? null,
        payment_details: {
          ...(purchase.payment_details ?? {}),
          confirmation: confirmation.raw,
          amountPaid: confirmation.amountGhs,
          confirmedAt: new Date().toISOString(),
        },
        updated_at: new Date().toISOString(),
      })
      .eq('id', purchase.id)
      .eq('status', 'pending')
      .select('id')
      .maybeSingle();

    if (claimError) throw new InternalServerErrorException(claimError.message);
    if (!claimed) return this.orderStatus(reference); // someone else fulfilled it

    const billing = purchase.payment_details?.billingDetails as BillingDetailsDto;
    const items = (purchase.items ?? []) as Array<{ productId: string; title?: string; price?: number; quantity?: number }>;
    const productIds = items.map((i) => i.productId);

    // Provisioning targets come from Sanity, never from the browser.
    const apps = await this.purchasesService.fetchProvisioningAppsByIds(productIds);
    const details: Record<string, any> = {};
    for (const app of apps) {
      if (!app.appProvisioning) continue;
      details[app._id] = {
        productId: app._id,
        name: app.title,
        useSameEmailAsAdmin: true,
        userEmail: billing.organizationEmail,
        supabaseUrl: app.appProvisioning.supabaseUrl,
        supabaseAnonKey: app.appProvisioning.supabaseAnonKey,
        edgeFunctionName: app.appProvisioning.edgeFunctionName,
      };
    }

    const results = Object.keys(details).length
      ? await this.purchasesService.provisionApps(purchase.organization_id, billing, details, 'buy')
      : [];
    await this.purchasesService.recordAppAccess(purchase.organization_id, productIds, 'buy');
    await supabase
      .from('purchases')
      .update({
        confirmation_email_details: results.map((r: any) => ({
          appId: r.productId,
          appName: details[r.productId]?.name,
          emailSent: r.success,
          emailSentAt: r.success ? new Date().toISOString() : undefined,
          emailError: r.error,
        })),
      })
      .eq('id', purchase.id);

    try {
      await this.purchasesService.sendPurchaseConfirmationEmail(
        { organizationName: billing.organizationName, organizationEmail: billing.organizationEmail },
        items,
        expected,
      );
    } catch (error) {
      await this.purchasesService.logPurchaseIssue({
        title: 'Failed to send confirmation email',
        description: `Store order ${reference}`,
        errorMessage: (error as Error).message,
        organizationId: purchase.organization_id,
        purchaseId: purchase.id,
        severity: 'medium',
      });
    }

    const failed = results.filter((r: any) => !r.success);
    if (failed.length) {
      await this.purchasesService.logPurchaseIssue({
        title: 'Store order paid but provisioning failed',
        description: `Order ${reference}: ${failed.map((f: any) => `${f.productId}: ${f.error}`).join('; ')}`,
        organizationId: purchase.organization_id,
        purchaseId: purchase.id,
        severity: 'critical',
      });
    }

    return this.orderStatus(reference);
  }

  // ---------------------------------------------------------------- providers

  private async checkPaystack(reference: string): Promise<ProviderConfirmation> {
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

  private publicApiOrigin() {
    const url = this.configService.get<string>('PUBLIC_API_URL') || this.configService.get<string>('FRONTEND_URL') || '';
    return url.replace(/\/+$/, '').replace(/\/api$/, '');
  }

  private siteOrigin() {
    return (this.configService.get<string>('FRONTEND_URL') || 'https://fmtsoftware.com').replace(/\/+$/, '');
  }

  /** Creates a Hubtel hosted checkout server-side; the browser only gets the page URL. */
  private async initiateHubtel(reference: string, total: number, items: PricedItem[], billing: BillingDetailsDto) {
    const { basic, merchant } = this.hubtelAuth();
    const site = this.siteOrigin();
    const res = await fetch('https://payproxyapi.hubtel.com/items/initiate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Basic ${basic}` },
      body: JSON.stringify({
        totalAmount: total,
        description: items.length === 1 ? `Payment for ${items[0].title}` : `Payment for ${items.length} apps`,
        callbackUrl: `${this.publicApiOrigin()}/api/payments/hubtel/callback`,
        returnUrl: `${site}/order-complete?reference=${reference}`,
        cancellationUrl: `${site}/checkout/${items[0].productId}?cancelled=1`,
        merchantAccountNumber: merchant,
        clientReference: reference,
        payeeName: billing.organizationName,
        payeeMobileNumber: toHubtelMsisdn(billing.phoneNumber),
        payeeEmail: billing.organizationEmail,
      }),
    });
    const body: any = await res.json().catch(() => null);
    const url = body?.data?.checkoutDirectUrl || body?.data?.checkoutUrl;
    if (!res.ok || !url) {
      await this.issuesService.logApiError('Hubtel initiate failed', 'hubtel_initiate', 'POST', { reference, status: res.status, body });
      throw new BadRequestException('Could not start the Hubtel payment. Please try again or pay with Paystack.');
    }
    return url as string;
  }

  /** Asks Hubtel directly whether a reference was paid. */
  private async checkHubtel(reference: string): Promise<ProviderConfirmation> {
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

  // ---------------------------------------------------------------- helpers

  private async findPurchase(reference: string) {
    const supabase: any = this.supabaseService.getServiceRoleClient();
    const { data, error } = await supabase
      .from('purchases')
      .select('id, organization_id, status, amount, items, payment_provider, payment_details')
      .eq('client_reference', reference)
      .maybeSingle();
    if (error) throw new InternalServerErrorException(error.message);
    return data as null | {
      id: string;
      organization_id: string;
      status: string;
      amount: number;
      items: any[];
      payment_provider: string;
      payment_details: any;
    };
  }

  /** Only what the payer already knows: no organisation or contact details. */
  private async orderStatus(reference: string) {
    const purchase = await this.findPurchase(reference);
    if (!purchase) throw new NotFoundException('Order not found');
    return {
      reference,
      status: purchase.status as 'pending' | 'completed' | 'underpaid' | 'failed',
      amount: Number(purchase.amount),
      items: (purchase.items ?? []).map((i: any) => ({ productId: i.productId, title: i.title, slug: i.product?.slug ?? i.slug })),
    };
  }
}
