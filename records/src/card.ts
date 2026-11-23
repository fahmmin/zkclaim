// Policy cards: the patient's virtual insurance card. Private; only its commitment is on-chain.
import { concat, decodeUtf8, encodeUtf8, fromBase64Url, isBytes32, toBase64Url } from './bytes.js';
import { type EncIdentity, openSealed, sealTo } from './crypto.js';

export type PolicyCard = {
  /** The contract's PolicyTerms: `covered` is exactly 8 CPT codes, 0 = empty slot. */
  terms: { holderPk: Uint8Array; limit: bigint; expiresAt: bigint; covered: bigint[] };
  salt: Uint8Array;
  holderName: string;
  insurer: string;
  plan: string;
  issuedAt: number;
  /** policyCommitment(terms, salt) as hex, filled in by the caller. */
  policyId: string;
};

const VERSION = 1;
const inRange = (x: unknown, max: bigint) => typeof x === 'bigint' && x >= 0n && x < max;

// Big-endian binary: version u8 | holderPk 32 | salt 32 | limit u64 | expiresAt u64 | covered 8 x u32 |
// issuedAt f64 | holderName, insurer, plan, policyId each as u16 length + UTF-8. About 250 bytes.
function cardBytes(card: PolicyCard): Uint8Array {
  const fail = (what: string): never => {
    throw new Error(`Invalid policy card: ${what}`);
  };
  const t = card?.terms;
  if (!isBytes32(t?.holderPk)) fail('terms.holderPk must be 32 bytes');
  if (!isBytes32(card.salt)) fail('salt must be 32 bytes');
  if (!inRange(t.limit, 2n ** 64n) || !inRange(t.expiresAt, 2n ** 64n)) fail('terms.limit and terms.expiresAt must be Uint<64> bigints');
  if (!Array.isArray(t.covered) || t.covered.length !== 8 || !t.covered.every((c) => inRange(c, 2n ** 32n))) {
    fail('terms.covered must be exactly 8 Uint<32> bigints (0 = empty slot)');
  }
  if (!Number.isFinite(card.issuedAt)) fail('issuedAt must be a number');
  const parts: Uint8Array[] = [Uint8Array.of(VERSION), t.holderPk, card.salt];
  const num = (size: number, write: (v: DataView) => void) => {
    const b = new Uint8Array(size);
    write(new DataView(b.buffer));
    parts.push(b);
  };
  num(8, (v) => v.setBigUint64(0, t.limit));
  num(8, (v) => v.setBigUint64(0, t.expiresAt));
  for (const c of t.covered) num(4, (v) => v.setUint32(0, Number(c)));
  num(8, (v) => v.setFloat64(0, card.issuedAt));
  for (const s of [card.holderName, card.insurer, card.plan, card.policyId]) {
    if (typeof s !== 'string') fail('holderName, insurer, plan and policyId must be strings');
    const b = encodeUtf8(s);
    if (b.length > 0xffff) fail('text fields must be under 64 KiB');
    num(2, (v) => v.setUint16(0, b.length));
    parts.push(b);
  }
  return concat(...parts);
}

function readCard(bytes: Uint8Array): PolicyCard {
  let at = 0;
  const take = (n: number) => {
    if (at + n > bytes.length) throw new Error('it is truncated');
    at += n;
    return bytes.slice(at - n, at);
  };
  const num = <T>(size: number, read: (v: DataView) => T): T => read(new DataView(take(size).buffer));
  if (take(1)[0] !== VERSION) throw new Error('unknown card format version');
  const holderPk = take(32);
  const salt = take(32);
  const limit = num(8, (v) => v.getBigUint64(0));
  const expiresAt = num(8, (v) => v.getBigUint64(0));
  const covered = Array.from({ length: 8 }, () => BigInt(num(4, (v) => v.getUint32(0))));
  const issuedAt = num(8, (v) => v.getFloat64(0));
  if (!Number.isFinite(issuedAt)) throw new Error('issuedAt is not a number');
  const [holderName, insurer, plan, policyId] = Array.from({ length: 4 }, () => decodeUtf8(take(num(2, (v) => v.getUint16(0)))));
  if (at !== bytes.length) throw new Error('it has trailing bytes');
  return { terms: { holderPk, limit, expiresAt, covered }, salt, holderName, insurer, plan, issuedAt, policyId };
}

/** Compact base64url text (about 315 chars with typical names) for a QR code or copy-paste. */
export function cardCode(card: PolicyCard): string {
  return toBase64Url(cardBytes(card));
}

export function readCardCode(code: string): PolicyCard {
  try {
    if (typeof code !== 'string') throw new Error('it is not a string');
    return readCard(fromBase64Url(code.trim()));
  } catch (e) {
    throw new Error(`Invalid policy card code: ${(e as Error).message}`);
  }
}

export async function sealCard(card: PolicyCard, holderPublicKey: Uint8Array): Promise<string> {
  return sealTo(holderPublicKey, cardBytes(card));
}

export async function openCard(sealed: string, identity: EncIdentity): Promise<PolicyCard> {
  const bytes = await openSealed(sealed, identity);
  try {
    return readCard(bytes);
  } catch (e) {
    throw new Error(`Sealed data is not a policy card: ${(e as Error).message}`);
  }
}
