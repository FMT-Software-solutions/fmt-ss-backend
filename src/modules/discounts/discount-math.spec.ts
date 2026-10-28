import { discountFor, DiscountRejected, type DiscountCodeRow } from './discount-math';

const base: DiscountCodeRow = {
  id: '1',
  code: 'SAVE10',
  description: null,
  value_type: 'percent',
  value: 10,
  app_ids: [],
  min_total: null,
  max_discount: null,
  starts_at: null,
  ends_at: null,
  max_uses: null,
  per_customer_limit: 1,
  first_purchase_only: false,
  is_active: true,
};
const lines = [
  { productId: 'stockflow', price: 3500 },
  { productId: 'psp', price: 3500 },
];

describe('discount codes', () => {
  it('takes a percentage of the order', () => {
    expect(discountFor(base, lines)).toBe(700);
  });

  it('caps percentages at max_discount', () => {
    expect(discountFor({ ...base, max_discount: 250 }, lines)).toBe(250);
  });

  it('only discounts the apps it is for', () => {
    expect(discountFor({ ...base, app_ids: ['stockflow'] }, lines)).toBe(350);
    expect(() => discountFor({ ...base, app_ids: ['churchhub'] }, lines)).toThrow(DiscountRejected);
  });

  it('applies fixed amounts, never below the minimum charge', () => {
    expect(discountFor({ ...base, value_type: 'fixed', value: 500 }, lines)).toBe(500);
    expect(discountFor({ ...base, value_type: 'fixed', value: 99999 }, [lines[0]])).toBe(3499);
    expect(discountFor({ ...base, value: 100 }, [lines[0]])).toBe(3499);
  });

  it('respects dates, minimum order and the active switch', () => {
    const now = new Date('2026-11-01T00:00:00Z');
    expect(() => discountFor({ ...base, ends_at: '2026-10-31T23:59:00Z' }, lines, now)).toThrow(/expired/);
    expect(() => discountFor({ ...base, starts_at: '2026-11-02T00:00:00Z' }, lines, now)).toThrow(/not active yet/);
    expect(() => discountFor({ ...base, min_total: 8000 }, lines)).toThrow(/at least/);
    expect(() => discountFor({ ...base, is_active: false }, lines)).toThrow(/no longer active/);
  });
});
