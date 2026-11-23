// Byte encodings and canonical JSON, identical in browsers and Node.

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

export const encodeUtf8 = (s: string): Uint8Array<ArrayBuffer> => encoder.encode(s);
export const decodeUtf8 = (b: Uint8Array): string => decoder.decode(b);
export const isBytes32 = (b: unknown): b is Uint8Array => b instanceof Uint8Array && b.length === 32;

export function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

const HEX = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, '0'));

export function toHex(b: Uint8Array): string {
  let s = '';
  for (const x of b) s += HEX[x];
  return s;
}

export function fromHex(s: string): Uint8Array<ArrayBuffer> {
  if (typeof s !== 'string' || !/^(?:[0-9a-fA-F]{2})*$/.test(s)) throw new Error('Invalid hex string');
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(2 * i, 2 * i + 2), 16);
  return out;
}

export function toBase64Url(b: Uint8Array): string {
  let bin = '';
  // Chunked: spreading a large array into one call overflows the stack.
  for (let i = 0; i < b.length; i += 0x8000) bin += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(s: string): Uint8Array<ArrayBuffer> {
  if (typeof s !== 'string' || !/^[A-Za-z0-9_-]*$/.test(s) || s.length % 4 === 1) throw new Error('Invalid base64url string');
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Canonical JSON: object keys sorted, no whitespace, so equal values give equal text (and hashes).
 * bigint -> {"$big":"123"}, Uint8Array -> {"$bytes":"<hex>"}. Properties set to undefined are
 * dropped, like JSON.stringify; anything parse() could not give back exactly throws.
 */
export function stringify(value: unknown): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'string':
    case 'boolean':
      return JSON.stringify(value);
    case 'number':
      if (!Number.isFinite(value)) throw new Error(`Cannot stringify the number ${value}`);
      return JSON.stringify(value);
    case 'bigint':
      return `{"$big":"${value}"}`;
    case 'object': {
      if (value instanceof Uint8Array) return `{"$bytes":"${toHex(value)}"}`;
      if (Array.isArray(value)) return `[${Array.from(value, (v) => stringify(v)).join(',')}]`;
      const proto = Object.getPrototypeOf(value);
      if (proto !== Object.prototype && proto !== null) throw new Error(`Cannot stringify a ${proto.constructor?.name ?? 'class'} instance`);
      const obj = value as Record<string, unknown>;
      const keys = Object.keys(obj).filter((k) => obj[k] !== undefined).sort();
      if (keys.length === 1 && (keys[0] === '$big' || keys[0] === '$bytes')) throw new Error(`Cannot stringify an object whose only key is ${keys[0]}`);
      return `{${keys.map((k) => `${JSON.stringify(k)}:${stringify(obj[k])}`).join(',')}}`;
    }
  }
  throw new Error(`Cannot stringify a ${typeof value}`);
}

/** Exact inverse of stringify. */
export function parse<T>(text: string): T {
  return JSON.parse(text, (_key, v: unknown) => {
    if (v === null || typeof v !== 'object' || Array.isArray(v) || v instanceof Uint8Array) return v;
    const keys = Object.keys(v);
    if (keys.length !== 1) return v;
    const inner = (v as Record<string, unknown>)[keys[0]];
    if (keys[0] === '$big') {
      if (typeof inner !== 'string' || !/^(?:0|-?[1-9]\d*)$/.test(inner)) throw new Error(`Invalid $big value: ${JSON.stringify(inner)}`);
      return BigInt(inner);
    }
    if (keys[0] === '$bytes') {
      if (typeof inner !== 'string') throw new Error('Invalid $bytes value');
      return fromHex(inner);
    }
    return v;
  }) as T;
}
