import { describe, expect, it } from 'vitest';
import { cardCode, newEncIdentity, openCard, type PolicyCard, readCardCode, sealCard, sealTo, toBase64Url } from '../index.js';

const card: PolicyCard = {
  terms: { holderPk: new Uint8Array(32).fill(7), limit: 1_000_000_000n, expiresAt: 1_830_000_000n, covered: [92928n, 27447n, 70551n, 0n, 0n, 0n, 0n, 0n] },
  salt: new Uint8Array(32).fill(9),
  holderName: 'Elena Marsh',
  insurer: 'Nightingale Mutual',
  plan: 'Gold Care 1000',
  issuedAt: 1_795_000_000_000,
  policyId: 'ab'.repeat(32),
};

describe('card codes', () => {
  it('round-trip through compact base64url text', () => {
    const code = cardCode(card);
    expect(code).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(code.length).toBeLessThan(400);
    expect(readCardCode(code)).toEqual(card);
    expect(readCardCode(`  ${code}\n`)).toEqual(card);
    const unicode = { ...card, holderName: 'Zoë Ångström 李' };
    expect(readCardCode(cardCode(unicode))).toEqual(unicode);
  });

  it('reject garbage with a clear error', () => {
    const code = cardCode(card);
    for (const bad of ['', 'hello world', '!!!!', toBase64Url(new Uint8Array(200)), code.slice(0, -8), `${code}AAAA`, `B${code.slice(1)}`]) {
      expect(() => readCardCode(bad)).toThrow('Invalid policy card code');
    }
    expect(() => readCardCode(undefined as unknown as string)).toThrow('Invalid policy card code');
  });

  it('refuse a card the contract could not use', () => {
    expect(() => cardCode({ ...card, terms: { ...card.terms, covered: [92928n] } })).toThrow('exactly 8');
    expect(() => cardCode({ ...card, terms: { ...card.terms, covered: [2n ** 32n, 0n, 0n, 0n, 0n, 0n, 0n, 0n] } })).toThrow('exactly 8');
    expect(() => cardCode({ ...card, terms: { ...card.terms, limit: -1n } })).toThrow('Uint<64>');
    expect(() => cardCode({ ...card, salt: new Uint8Array(31) })).toThrow('salt');
  });
});

describe('sealCard / openCard', () => {
  it('opens for the holder only', async () => {
    const [holder, other] = [await newEncIdentity(), await newEncIdentity()];
    const sealed = await sealCard(card, holder.publicKey);
    expect(await openCard(sealed, holder)).toEqual(card);
    await expect(openCard(sealed, other)).rejects.toThrow('wrong key');
    await expect(openCard(await sealTo(holder.publicKey, new Uint8Array(10)), holder)).rejects.toThrow('not a policy card');
  });
});
