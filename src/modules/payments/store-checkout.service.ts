import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'crypto';
import { SupabaseService } from '../../common/supabase/supabase.service';
import { SanityService } from '../../common/sanity/sanity.service';
import { IssuesService } from '../issues/issues.service';
import { PurchasesService } from '../purchases/purchases.service';
import type { BillingDetailsDto } from '../purchases/dto/purchase.dto';
import type { CreateStoreOrderDto } from './dto/store-order.dto';
import { PaymentProvidersService, type ProviderConfirmation } from '../../common/payment-providers/payment-providers.service';
import { DiscountsService } from '../discounts/discounts.service';

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

const round2 = (n: number) => Math.round(n * 100) / 100;


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
    private readonly purchasesService: PurchasesService,
    private readonly issuesService: IssuesService,
    private readonly providers: PaymentProvidersService,
    private readonly discounts: DiscountsService,
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

  /** Server price for the checkout summary, with a discount code if given. */
  async quote(productIds: string[], discountCode?: string, email?: string) {
    const { items, total: subtotal } = await this.priceProducts(productIds);
    const discount = discountCode?.trim()
      ? await this.discounts.apply(discountCode, items.map((i) => ({ productId: i.productId, price: i.price })), email)
      : null;
    return { items, subtotal, discount, total: round2(subtotal - (discount?.amount ?? 0)) };
  }

  // ---------------------------------------------------------------- create

  async createOrder(dto: CreateStoreOrderDto) {
    const billing = dto.billingDetails;
    const { items, subtotal, discount, total } = await this.quote(dto.productIds, dto.discountCode, billing.organizationEmail);

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
      paymentDetails: {
        source: 'store',
        billingDetails: billing,
        subtotal,
        discount: discount ? { codeId: discount.codeId, code: discount.code, amount: discount.amount } : null,
        createdAt: new Date().toISOString(),
      },
    });

    if (dto.provider === 'paystack') {
      // The popup uses the website's own public key; the server only needs the secret key to verify.
      return { provider: 'paystack' as const, reference, amount: total, currency: 'GHS', email: billing.organizationEmail, items };
    }

    const site = this.providers.siteOrigin();
    let checkoutUrl: string;
    try {
      checkoutUrl = await this.providers.initiateHubtel({
        reference,
        amount: total,
        description: items.length === 1 ? `Payment for ${items[0].title}` : `Payment for ${items.length} apps`,
        returnUrl: `${site}/order-complete?reference=${reference}`,
        cancellationUrl: `${site}/checkout/${items[0].productId}?cancelled=1`,
        payee: { name: billing.organizationName, phone: billing.phoneNumber, email: billing.organizationEmail },
      });
    } catch (error) {
      await this.issuesService.logApiError(error as Error, 'hubtel_initiate', 'POST', { reference });
      throw error;
    }
    return { provider: 'hubtel' as const, reference, amount: total, currency: 'GHS', checkoutUrl, items };
  }

  // ---------------------------------------------------------------- confirm

  /** Browser return, webhook and polling all end up here for Paystack. */
  async confirmPaystack(reference: string) {
    const confirmation = await this.providers.checkPaystack(reference);
    if (!confirmation.paid) return this.orderStatus(reference);
    return this.fulfil(reference, 'paystack', confirmation);
  }

  /** Hubtel callback, the return page and polling all end up here for Hubtel. */
  async confirmHubtel(reference: string) {
    const confirmation = await this.providers.checkHubtel(reference);
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

    const discount = purchase.payment_details?.discount;
    if (discount?.codeId) {
      await this.discounts.recordRedemption({
        codeId: discount.codeId,
        purchaseId: purchase.id,
        organizationId: purchase.organization_id,
        email: billing.organizationEmail,
        amount: Number(discount.amount),
      });
    }

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
