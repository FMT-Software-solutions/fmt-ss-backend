import { createHmac, randomBytes } from 'crypto';
import { PaymentsService } from './payments.service';

/**
 * The webhook is a public endpoint that grants paid goods, so the signature
 * check is the only thing standing between an attacker and free SMS credits.
 */
describe('PaymentsService.verifyPaystackSignature', () => {
  // Generated per run rather than hard-coded: a literal shaped like a real
  // key trips GitHub's push protection, and there is no reason for this file
  // to contain anything that looks like a credential.
  const SECRET = randomBytes(24).toString('hex');

  // Only ConfigService is touched by this method.
  const service = new PaymentsService(
    {} as any,
    { get: (key: string) => (key === 'PAYSTACK_SECRET_KEY' ? SECRET : undefined) } as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
  );

  const body = JSON.stringify({
    event: 'charge.success',
    data: { reference: 'ref_123', amount: 2000, metadata: { organizationId: 'org-1' } },
  });
  const sign = (payload: string, secret = SECRET) =>
    createHmac('sha512', secret).update(payload).digest('hex');

  it('accepts a correctly signed payload', () => {
    expect(service.verifyPaystackSignature(body, sign(body))).toBe(true);
  });

  it('accepts the raw body as a Buffer, as Express supplies it', () => {
    expect(service.verifyPaystackSignature(Buffer.from(body), sign(body))).toBe(true);
  });

  it('rejects a payload signed with the wrong secret', () => {
    const otherSecret = randomBytes(24).toString('hex');
    expect(service.verifyPaystackSignature(body, sign(body, otherSecret))).toBe(false);
  });

  it('rejects a tampered body', () => {
    const signature = sign(body);
    const tampered = body.replace('"amount":2000', '"amount":9999999');
    expect(service.verifyPaystackSignature(tampered, signature)).toBe(false);
  });

  it('rejects a missing or malformed signature', () => {
    expect(service.verifyPaystackSignature(body, undefined)).toBe(false);
    expect(service.verifyPaystackSignature(body, '')).toBe(false);
    expect(service.verifyPaystackSignature(body, 'not-a-signature')).toBe(false);
  });

  it('rejects a missing body', () => {
    expect(service.verifyPaystackSignature(undefined, sign(body))).toBe(false);
  });

  it('rejects a signature of the right length but wrong content', () => {
    // Guards the timingSafeEqual path, which throws on length mismatch.
    const valid = sign(body);
    const forged = 'a'.repeat(valid.length);
    expect(service.verifyPaystackSignature(body, forged)).toBe(false);
  });
});
