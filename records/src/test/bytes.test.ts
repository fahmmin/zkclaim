import { describe, expect, it } from 'vitest';
import { fromBase64Url, fromHex, parse, stringify, toBase64Url, toHex } from '../index.js';

describe('stringify / parse', () => {
  it('round-trips bigint, bytes and nested values exactly', () => {
    const value = { b: [1, 'x', null, true, { z: 2n ** 70n, neg: -5n }], a: new Uint8Array([0, 1, 255]), s: 'é ☃ "q"', n: -1.5 };
    const text = stringify(value);
    expect(parse(text)).toEqual(value);
    expect(stringify(parse(text))).toBe(text);
  });

  it('sorts keys, so key order never changes the text', () => {
    expect(stringify({ b: 1, a: { d: 2, c: 3 }, 10: 'x', 9: 'y' })).toBe('{"10":"x","9":"y","a":{"c":3,"d":2},"b":1}');
    expect(stringify({ a: { c: 3, d: 2 }, b: 1 })).toBe(stringify({ b: 1, a: { d: 2, c: 3 } }));
  });

  it('encodes bigint and bytes as tagged objects', () => {
    expect(stringify({ x: 123n, y: new Uint8Array([0xab, 0x01]), skipped: undefined })).toBe('{"x":{"$big":"123"},"y":{"$bytes":"ab01"}}');
  });

  it('refuses values it could not give back', () => {
    for (const bad of [undefined, NaN, Infinity, new Date(), new Map(), () => 1, { $big: '1' }, [undefined], new Uint16Array(2)]) {
      expect(() => stringify(bad)).toThrow(/Cannot stringify/);
    }
  });

  it('rejects malformed tagged values', () => {
    expect(() => parse('{"$big":"12a"}')).toThrow('Invalid $big');
    expect(() => parse('{"$big":" 1"}')).toThrow('Invalid $big');
    expect(() => parse('{"$bytes":"abc"}')).toThrow('Invalid hex');
  });
});

describe('hex and base64url', () => {
  const bytes = Uint8Array.from({ length: 300 }, (_, i) => (i * 7) & 255);

  it('round-trip, including large arrays', () => {
    expect(fromHex(toHex(bytes))).toEqual(bytes);
    expect(fromBase64Url(toBase64Url(bytes))).toEqual(bytes);
    // Compared by hand: vitest's toEqual takes seconds on arrays this size.
    const big = Uint8Array.from({ length: 200_000 }, (_, i) => (i * 31) & 255);
    for (const back of [fromBase64Url(toBase64Url(big)), fromHex(toHex(big))]) {
      expect(back.length === big.length && back.every((x, i) => x === big[i])).toBe(true);
    }
    expect(toBase64Url(new Uint8Array([251, 255]))).toBe('-_8');
    expect(toHex(new Uint8Array([0, 15, 255]))).toBe('000fff');
  });

  it('reject garbage', () => {
    for (const bad of ['abc', 'zz', '0x00']) expect(() => fromHex(bad)).toThrow('Invalid hex');
    for (const bad of ['a+b/', 'abcde', 'ab==', 'a b']) expect(() => fromBase64Url(bad)).toThrow('Invalid base64url');
  });
});
