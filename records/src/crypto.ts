// X25519 sealing (ECIES) and AES-256-GCM boxes, on WebCrypto only.
import { concat, encodeUtf8, fromBase64Url, toBase64Url } from './bytes.js';

/** An X25519 key pair: `publicKey` is the 32 raw bytes, `privateKey` the PKCS#8 export. */
export type EncIdentity = { publicKey: Uint8Array; privateKey: Uint8Array };

function subtle(): SubtleCrypto {
  const s = globalThis.crypto?.subtle;
  if (!s) throw new Error('WebCrypto is unavailable: serve the app from http://localhost or https');
  return s;
}

export const randomBytes = (n: number): Uint8Array<ArrayBuffer> => globalThis.crypto.getRandomValues(new Uint8Array(n));

export const sha256 = async (data: Uint8Array): Promise<Uint8Array<ArrayBuffer>> =>
  new Uint8Array(await subtle().digest('SHA-256', new Uint8Array(data)));

function checkBytes(b: unknown, length: number, what: string): asserts b is Uint8Array {
  if (!(b instanceof Uint8Array) || b.length !== length) throw new Error(`${what} must be ${length} bytes`);
}

export async function newEncIdentity(): Promise<EncIdentity> {
  const pair = (await subtle().generateKey({ name: 'X25519' }, true, ['deriveBits'])) as CryptoKeyPair;
  const [pub, priv] = await Promise.all([subtle().exportKey('raw', pair.publicKey), subtle().exportKey('pkcs8', pair.privateKey)]);
  return { publicKey: new Uint8Array(pub), privateKey: new Uint8Array(priv) };
}

const SEAL_INFO = encodeUtf8('zkclaim:seal:v1');
const MIN_SEALED = 32 + 12 + 16; // ephemeral public key, IV, GCM tag

/** AES key for one sealed message, bound to both public keys (as HPKE does). */
async function sealKey(shared: ArrayBuffer, ephemeralPk: Uint8Array, recipientPk: Uint8Array, usage: KeyUsage): Promise<CryptoKey> {
  const ikm = await subtle().importKey('raw', shared, 'HKDF', false, ['deriveKey']);
  const params = { name: 'HKDF', hash: 'SHA-256', salt: concat(ephemeralPk, recipientPk), info: SEAL_INFO };
  return subtle().deriveKey(params, ikm, { name: 'AES-GCM', length: 256 }, false, [usage]);
}

/** ECIES: ephemeral X25519 + HKDF-SHA256 + AES-256-GCM. Returns base64url(ephemeralPk | iv | ciphertext). */
export async function sealTo(recipientPublicKey: Uint8Array, plaintext: Uint8Array): Promise<string> {
  checkBytes(recipientPublicKey, 32, 'Recipient public key');
  if (recipientPublicKey.every((x) => x === 0)) throw new Error('Recipient public key is all zeros (is the key registered on-chain?)');
  if (!(plaintext instanceof Uint8Array)) throw new Error('Plaintext must be a Uint8Array');
  const recipient = await subtle().importKey('raw', new Uint8Array(recipientPublicKey), { name: 'X25519' }, true, []);
  const ephemeral = (await subtle().generateKey({ name: 'X25519' }, false, ['deriveBits'])) as CryptoKeyPair;
  const ephemeralPk = new Uint8Array(await subtle().exportKey('raw', ephemeral.publicKey));
  let shared: ArrayBuffer;
  try {
    shared = await subtle().deriveBits({ name: 'X25519', public: recipient }, ephemeral.privateKey, 256);
  } catch {
    throw new Error('Cannot seal to this public key: not a usable X25519 key');
  }
  const key = await sealKey(shared, ephemeralPk, recipientPublicKey, 'encrypt');
  const iv = randomBytes(12);
  const ct = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv }, key, new Uint8Array(plaintext)));
  return toBase64Url(concat(ephemeralPk, iv, ct));
}

export async function openSealed(sealed: string, identity: EncIdentity): Promise<Uint8Array> {
  const bytes = fromBase64Url(sealed);
  if (bytes.length < MIN_SEALED) throw new Error('Sealed data is too short');
  checkBytes(identity?.publicKey, 32, 'Identity public key');
  let privateKey: CryptoKey;
  try {
    privateKey = await subtle().importKey('pkcs8', new Uint8Array(identity.privateKey), { name: 'X25519' }, false, ['deriveBits']);
  } catch {
    throw new Error('Identity private key is not a PKCS#8 X25519 key');
  }
  const ephemeralPk = bytes.subarray(0, 32);
  try {
    const ephemeral = await subtle().importKey('raw', ephemeralPk, { name: 'X25519' }, true, []);
    const shared = await subtle().deriveBits({ name: 'X25519', public: ephemeral }, privateKey, 256);
    const key = await sealKey(shared, ephemeralPk, identity.publicKey, 'decrypt');
    return new Uint8Array(await subtle().decrypt({ name: 'AES-GCM', iv: bytes.subarray(32, 44) }, key, bytes.subarray(44)));
  } catch {
    throw new Error('Cannot open sealed data: wrong key or tampered ciphertext');
  }
}

/** One AES-256-GCM box under a raw 32-byte key; `aad` binds it to its slot. */
export type Box = { iv: string; ct: string };

export async function aesSeal(rawKey: Uint8Array, plaintext: Uint8Array, aad: Uint8Array): Promise<Box> {
  const key = await subtle().importKey('raw', new Uint8Array(rawKey), 'AES-GCM', false, ['encrypt']);
  const iv = randomBytes(12);
  const ct = await subtle().encrypt({ name: 'AES-GCM', iv, additionalData: new Uint8Array(aad) }, key, new Uint8Array(plaintext));
  return { iv: toBase64Url(iv), ct: toBase64Url(new Uint8Array(ct)) };
}

/** Throws on a wrong key or any change to the box: GCM authentication never returns garbage. */
export async function aesOpen(rawKey: Uint8Array, box: Box, aad: Uint8Array): Promise<Uint8Array> {
  checkBytes(rawKey, 32, 'AES key');
  const iv = fromBase64Url(box.iv);
  checkBytes(iv, 12, 'AES-GCM IV');
  const key = await subtle().importKey('raw', new Uint8Array(rawKey), 'AES-GCM', false, ['decrypt']);
  return new Uint8Array(await subtle().decrypt({ name: 'AES-GCM', iv, additionalData: new Uint8Array(aad) }, key, fromBase64Url(box.ct)));
}
