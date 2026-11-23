import { describe, expect, it } from 'vitest';
import { fromBase64Url, newEncIdentity, openSealed, sealTo, toBase64Url } from '../index.js';

const alice = await newEncIdentity();
const bob = await newEncIdentity();
const message = new TextEncoder().encode('lab result: troponin 4.2 ng/mL');

describe('sealTo / openSealed', () => {
  it('makes raw X25519 public keys and PKCS#8 private keys', () => {
    expect(alice.publicKey).toHaveLength(32);
    expect(alice.privateKey).toHaveLength(48);
  });

  it('opens for the recipient only', async () => {
    const sealed = await sealTo(alice.publicKey, message);
    expect(sealed).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(await openSealed(sealed, alice)).toEqual(message);
    await expect(openSealed(sealed, bob)).rejects.toThrow('wrong key or tampered ciphertext');
    expect(await sealTo(alice.publicKey, message)).not.toBe(sealed);
  });

  it('fails on any change, including the X25519-ignored top bit of the ephemeral key', async () => {
    const bytes = fromBase64Url(await sealTo(alice.publicKey, message));
    for (const [i, bit] of [[0, 1], [31, 0x80], [40, 1], [50, 1], [bytes.length - 1, 1]]) {
      const tampered = bytes.slice();
      tampered[i] ^= bit;
      await expect(openSealed(toBase64Url(tampered), alice)).rejects.toThrow('wrong key or tampered ciphertext');
    }
    await expect(openSealed(toBase64Url(bytes.subarray(0, 50)), alice)).rejects.toThrow('too short');
    await expect(openSealed('not base64!', alice)).rejects.toThrow('Invalid base64url');
  });

  it('rejects unusable keys', async () => {
    await expect(sealTo(new Uint8Array(31), message)).rejects.toThrow('must be 32 bytes');
    await expect(sealTo(new Uint8Array(32), message)).rejects.toThrow('all zeros');
    // u = 1 is a low-order point: the shared secret would be zero, readable by anyone.
    await expect(sealTo(Uint8Array.from({ length: 32 }, (_, i) => (i === 0 ? 1 : 0)), message)).rejects.toThrow('not a usable X25519 key');
    const sealed = await sealTo(alice.publicKey, message);
    await expect(openSealed(sealed, { ...alice, privateKey: new Uint8Array(48) })).rejects.toThrow('PKCS#8');
    await expect(openSealed(sealed, { ...alice, publicKey: bob.publicKey })).rejects.toThrow('wrong key');
  });
});
