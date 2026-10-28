/**
 * How a discount code applies to an order. Pure, so the rules are testable;
 * usage limits (which need the database) are checked by DiscountsService.
 */

export interface DiscountCodeRow {
  id: string;
  code: string;
  description: string | null;
  value_type: 'percent' | 'fixed';
  value: number;
  app_ids: string[];
  min_total: number | null;
  max_discount: number | null;
  starts_at: string | null;
  ends_at: string | null;
  max_uses: number | null;
  per_customer_limit: number;
  first_purchase_only: boolean;
  is_active: boolean;
}

export interface PricedLine {
  productId: string;
  price: number;
}

export class DiscountRejected extends Error { }

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Smallest amount we'll charge after a discount (payment providers need > 0). */
export const MIN_CHARGE = 1;

/** The discount in GHS, or throws DiscountRejected with a reason for the buyer. */
export function discountFor(code: DiscountCodeRow, lines: PricedLine[], now = new Date()): number {
  if (!code.is_active) throw new DiscountRejected('This code is no longer active');
  if (code.starts_at && now < new Date(code.starts_at)) throw new DiscountRejected('This code is not active yet');
  if (code.ends_at && now > new Date(code.ends_at)) throw new DiscountRejected('This code has expired');

  const subtotal = round2(lines.reduce((s, l) => s + l.price, 0));
  if (code.min_total != null && subtotal < Number(code.min_total)) {
    throw new DiscountRejected(`This code needs an order of at least GHS ${Number(code.min_total).toFixed(2)}`);
  }

  const eligible = code.app_ids?.length ? lines.filter((l) => code.app_ids.includes(l.productId)) : lines;
  if (!eligible.length) throw new DiscountRejected("This code doesn't apply to these apps");
  const eligibleTotal = round2(eligible.reduce((s, l) => s + l.price, 0));

  let amount =
    code.value_type === 'percent' ? round2((eligibleTotal * Number(code.value)) / 100) : round2(Number(code.value));
  if (code.max_discount != null) amount = Math.min(amount, Number(code.max_discount));
  amount = Math.min(amount, eligibleTotal);
  // Never discount below the minimum charge.
  amount = Math.min(amount, round2(subtotal - MIN_CHARGE));
  if (!(amount > 0)) throw new DiscountRejected("This code doesn't reduce this order");
  return round2(amount);
}

export const normalizeCode = (code: string) => code.trim().toUpperCase();
