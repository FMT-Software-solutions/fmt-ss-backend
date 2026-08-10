/**
 * Server-side pricing authority.
 *
 * What a payment BUYS is decided here, from the amount Paystack confirms was
 * actually charged. It is never taken from a request body.
 *
 * This matters: the credit amount used to arrive as a query parameter on the
 * payment callback URL (`?credits=…`), get read back by the client, and be
 * posted to /verify-sms-purchase, which granted exactly that many credits. Only
 * the AMOUNT was checked against Paystack, so paying GHS 20 and editing the URL
 * granted arbitrary credits. Deriving here closes that.
 *
 * Keep in sync with the client-side tier tables, which exist only to render
 * prices — they are display, this is truth:
 *   print-calc-pro/src/shared-packages/communication/.../types/sms-credits.ts
 *   print-calc-pro/src/types/storage.ts
 */

/** GHS per SMS credit. See internal-docs/SMS_CREDIT_USAGE_PLAN.md. */
export const SMS_CREDIT_RATE_GHS = 0.048;

const GIB = 1024 * 1024 * 1024;

/** GHS → bytes. Ascending by amount; a payment buys the largest tier it covers. */
export const STORAGE_TIERS: { amountGhs: number; bytes: number }[] = [
  { amountGhs: 5, bytes: 1 * GIB },
  { amountGhs: 20, bytes: 5 * GIB },
  { amountGhs: 35, bytes: 10 * GIB },
  { amountGhs: 75, bytes: 25 * GIB },
];

/** Credits earned by a confirmed GHS amount. */
export function creditsForAmount(amountGhs: number): number {
  if (!Number.isFinite(amountGhs) || amountGhs <= 0) return 0;
  return Math.floor(amountGhs / SMS_CREDIT_RATE_GHS);
}

/**
 * Bytes earned by a confirmed GHS amount — the largest tier the payment covers.
 * Overpaying does not round up to the next tier; underpaying a tier grants the
 * one below (or nothing), so a tampered amount can never buy more than it paid for.
 */
export function bytesForAmount(amountGhs: number): number {
  if (!Number.isFinite(amountGhs) || amountGhs <= 0) return 0;
  let bytes = 0;
  for (const tier of STORAGE_TIERS) {
    if (amountGhs + 1e-9 >= tier.amountGhs) bytes = tier.bytes;
  }
  return bytes;
}
