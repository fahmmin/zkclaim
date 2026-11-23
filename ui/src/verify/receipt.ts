// Settlement receipt: the public ledger facts of one paid claim, small enough for a URL hash or a QR code, plus the
// rules that decide whether the ledger agrees with it. No imports: the verifier page, the role app and the CLI share it.
// Only these fields ever go in. Never the policy card's code: it carries the holder, the terms and the salt.

export type Receipt = {
  /** Midnight network id: `undeployed` (local devnet) or `preprod`. */
  network: string;
  /** Contract address, 64 hex. */
  contract: string;
  /** The claim nullifier: its key in the ledger's `claims` map. */
  nullifier: string;
  /** Policy commitment stored with the settlement. */
  policy: string;
  /** Amount paid, in integer base units (1 NIGHT = 1,000,000). */
  amount: bigint;
  /** `Settlement.at`, Unix seconds. */
  at: bigint;
};

/** A `claims` entry as the ledger holds it, bytes as hex. */
export type Settlement = { policy: string; amount: bigint; at: bigint };

/** What the trusted indexer said: the contract it read (null: none at that address) and its entry for the nullifier. */
export type Read = { address: string | null; claim: Settlement | null };

/** The trust anchor a verifier build carries. Nothing in a receipt can change it. */
export type Anchor = { network: string; label: string; indexer: string; contract: string | null };

export type Verdict = { result: 'match' | 'mismatch' | 'unknown'; reasons: string[] };

const VERSION = '1';
const KEYS = ['v', 'net', 'contract', 'nullifier', 'policy', 'amount', 'at'];
const UINT64_MAX = 2n ** 64n - 1n;

/** The one indexer read a receipt needs. `api/indexer.mjs` forwards exactly this text and nothing else. */
export const QUERY = 'query ZkClaimReceipt($address: HexEncoded!) { contractAction(address: $address) { __typename address state stateAt { height hash protocolVersion } } }';

export const encodeReceipt = (r: Receipt) =>
  new URLSearchParams({ v: VERSION, net: r.network, contract: r.contract, nullifier: r.nullifier, policy: r.policy, amount: String(r.amount), at: String(r.at) }).toString();

/** The verifier link. The receipt rides in the hash, which browsers never send to the server. */
export function receiptUrl(r: Receipt, base: string): string {
  const url = new URL('verify.html', base);
  url.hash = encodeReceipt(r);
  return url.href;
}

const hex32 = (name: string, text: string) => {
  const h = text.toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(h)) throw new Error(`"${name}" must be 64 hex characters`);
  return h;
};

const uint64 = (name: string, text: string) => {
  if (!/^\d{1,20}$/.test(text) || BigInt(text) > UINT64_MAX) throw new Error(`"${name}" must be a whole number below 2^64`);
  return BigInt(text);
};

/** Strict: exactly the allowlisted fields, once each. Throws an Error that says what is wrong. */
export function decodeReceipt(hash: string): Receipt {
  const p = new URLSearchParams(hash.replace(/^#/, ''));
  for (const k of p.keys()) if (!KEYS.includes(k)) throw new Error(`"${k}" is not a receipt field`);
  const one = (k: string) => {
    const all = p.getAll(k);
    if (all.length !== 1) throw new Error(all.length ? `"${k}" appears ${all.length} times` : `"${k}" is missing`);
    return all[0].trim();
  };
  const v = one('v');
  if (v !== VERSION) throw new Error(`receipt version "${v}" is not one this page reads (${VERSION})`);
  const network = one('net');
  if (!/^[a-z0-9-]{1,32}$/.test(network)) throw new Error('"net" is not a network id');
  return {
    network,
    contract: hex32('contract', one('contract')),
    nullifier: hex32('nullifier', one('nullifier')),
    policy: hex32('policy', one('policy')),
    amount: uint64('amount', one('amount')),
    at: uint64('at', one('at')),
  };
}

const unknown = (...reasons: string[]): Verdict => ({ result: 'unknown', reasons });
const mismatch = (...reasons: string[]): Verdict => ({ result: 'mismatch', reasons });

/** What is decided before reading anything: a receipt for another network, or for a deployment this build doesn't trust. */
export function precheck(r: Receipt, a: Anchor): Verdict | null {
  if (r.network !== a.network) return unknown(`This page checks ${a.label} only. The receipt is for the network "${r.network}".`);
  if (a.contract && r.contract !== a.contract) return mismatch(`Contract ${r.contract} is not the zkClaim deployment this page trusts (${a.contract}).`);
  return null;
}

export function judge(r: Receipt, read: Read): Verdict {
  if (read.address === null) return mismatch(`There is no contract at ${r.contract} on this network.`);
  if (read.address !== r.contract) return unknown(`The indexer answered for contract ${read.address}, not ${r.contract}.`);
  const c = read.claim;
  if (!c) return mismatch(`This contract has no settlement under nullifier ${r.nullifier}. A claim paid seconds ago may not be indexed yet: check again in a minute.`);
  const diffs = [
    c.amount !== r.amount && `Amount: the receipt says ${r.amount}, the ledger ${c.amount} base units.`,
    c.policy !== r.policy && `Policy: the receipt says ${r.policy}, the ledger ${c.policy}.`,
    c.at !== r.at && `Settlement time: the receipt says ${r.at}, the ledger ${c.at}.`,
  ].filter((d): d is string => !!d);
  return diffs.length ? mismatch(...diffs) : { result: 'match', reasons: ['The ledger holds this nullifier with exactly this policy, amount and time.'] };
}

/** The whole check. Only a successful read whose values equal the receipt's is a match: any failure is "unknown". */
export async function verify<T extends Read>(r: Receipt, a: Anchor, read: () => Promise<T>): Promise<{ verdict: Verdict; read?: T; error?: unknown }> {
  const pre = precheck(r, a);
  if (pre) return { verdict: pre };
  try {
    const got = await read();
    return { verdict: judge(r, got), read: got };
  } catch (error) {
    return { verdict: unknown(`Could not read the ledger: ${error instanceof Error ? error.message : String(error)}.`), error };
  }
}

/** Base units as NIGHT, exact (service.ts has the same; this page may not import the role app). */
export function nightText(units: bigint, unit = true): string {
  const frac = (units % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '');
  return `${(units / 1_000_000n).toLocaleString('en-US')}${frac ? `.${frac}` : ''}${unit ? ' NIGHT' : ''}`;
}
