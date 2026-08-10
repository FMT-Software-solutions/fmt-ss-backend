import { bytesForAmount, creditsForAmount, SMS_CREDIT_RATE_GHS } from './pricing';

const GIB = 1024 * 1024 * 1024;

describe('creditsForAmount', () => {
  it('prices the published SMS tiers', () => {
    expect(creditsForAmount(20)).toBe(Math.floor(20 / SMS_CREDIT_RATE_GHS));
    expect(creditsForAmount(100)).toBe(Math.floor(100 / SMS_CREDIT_RATE_GHS));
    expect(creditsForAmount(5000)).toBe(Math.floor(5000 / SMS_CREDIT_RATE_GHS));
  });

  it('never grants credits for a non-payment', () => {
    expect(creditsForAmount(0)).toBe(0);
    expect(creditsForAmount(-100)).toBe(0);
    expect(creditsForAmount(NaN)).toBe(0);
    expect(creditsForAmount(Infinity)).toBe(0);
  });

  it('rounds down, so a payment never buys a fraction it did not cover', () => {
    // 0.05 buys one credit at 0.048 with change left over, not two.
    expect(creditsForAmount(0.05)).toBe(1);
    expect(creditsForAmount(0.047)).toBe(0);
  });

  it('is monotonic in the amount paid', () => {
    // The property that matters: credits are a function of the money and
    // nothing else, and paying more never yields fewer. Not strictly linear —
    // flooring means floor(40/0.048) is 833, one more than 2 * floor(20/0.048).
    const amounts = [20, 40, 50, 60, 80, 100, 150, 200, 500, 1000, 2000, 5000];
    for (let i = 1; i < amounts.length; i++) {
      expect(creditsForAmount(amounts[i])).toBeGreaterThan(creditsForAmount(amounts[i - 1]));
    }
  });
});

describe('bytesForAmount', () => {
  it('grants the exact tier for an exact payment', () => {
    expect(bytesForAmount(5)).toBe(1 * GIB);
    expect(bytesForAmount(20)).toBe(5 * GIB);
    expect(bytesForAmount(35)).toBe(10 * GIB);
    expect(bytesForAmount(75)).toBe(25 * GIB);
  });

  it('grants nothing below the cheapest tier', () => {
    expect(bytesForAmount(4.99)).toBe(0);
    expect(bytesForAmount(0)).toBe(0);
    expect(bytesForAmount(-5)).toBe(0);
  });

  it('never rounds up to a tier the payment did not cover', () => {
    expect(bytesForAmount(19.99)).toBe(1 * GIB);
    expect(bytesForAmount(34)).toBe(5 * GIB);
    expect(bytesForAmount(74.5)).toBe(10 * GIB);
  });

  it('caps at the largest tier when overpaid', () => {
    expect(bytesForAmount(10_000)).toBe(25 * GIB);
  });
});
