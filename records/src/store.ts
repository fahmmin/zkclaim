// Content-addressed blob storage: a Kubo (IPFS) node, or memory for demo mode.
import { concat, decodeUtf8, encodeUtf8, parse, stringify } from './bytes.js';
import { sha256 } from './crypto.js';

export interface BlobStore {
  /** Returns the CID. */
  put(data: Uint8Array): Promise<string>;
  get(cid: string): Promise<Uint8Array>;
}

/** Kubo HTTP RPC. The node needs CORS for the page's origin (see records/ipfs/). */
export function kuboStore(apiUrl = 'http://127.0.0.1:5001'): BlobStore {
  const base = apiUrl.replace(/\/+$/, '');
  const rpc = async (command: string, query: string, body?: FormData): Promise<Response> => {
    let res: Response;
    try {
      res = await fetch(`${base}/api/v0/${command}?${query}`, { method: 'POST', body });
    } catch (e) {
      throw new Error(`IPFS node at ${base} is not reachable (docker compose up -d --wait ipfs): ${(e as Error).message}`);
    }
    if (!res.ok) {
      const text = await res.text();
      let message = text.trim();
      try {
        message = JSON.parse(text).Message ?? message;
      } catch {
        // not JSON: keep the text
      }
      throw new Error(`IPFS ${command} failed (HTTP ${res.status}): ${message}`);
    }
    return res;
  };
  return {
    async put(data) {
      const form = new FormData();
      form.append('file', new Blob([new Uint8Array(data)]));
      const { Hash } = (await (await rpc('add', 'cid-version=1&pin=true', form)).json()) as { Hash?: string };
      if (!Hash) throw new Error('IPFS add returned no CID');
      return Hash;
    },
    async get(cid) {
      if (typeof cid !== 'string' || !cid) throw new Error('CID must be a non-empty string');
      return new Uint8Array(await (await rpc('cat', `arg=${encodeURIComponent(cid)}`)).arrayBuffer());
    },
  };
}

const BASE32 = 'abcdefghijklmnopqrstuvwxyz234567';

function base32(bytes: Uint8Array): string {
  let out = '';
  let bits = 0;
  let value = 0;
  for (const b of bytes) {
    value = (value << 8) | b; // only the low `bits` bits are read, so overflow above them is harmless
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += BASE32[(value >>> bits) & 31];
    }
  }
  return bits ? out + BASE32[(value << (5 - bits)) & 31] : out;
}

/** CIDv1, raw codec, sha2-256, base32: the CID Kubo gives a file of up to 256 KiB (one raw block). */
async function rawCid(data: Uint8Array): Promise<string> {
  return `b${base32(concat(Uint8Array.of(0x01, 0x55, 0x12, 0x20), await sha256(data)))}`;
}

/** In-memory store for demo mode, with real CIDs, so the UI looks the same. */
export function memoryStore(): BlobStore {
  const blobs = new Map<string, Uint8Array>();
  return {
    async put(data) {
      const cid = await rawCid(data);
      blobs.set(cid, new Uint8Array(data));
      return cid;
    },
    async get(cid) {
      const data = blobs.get(cid);
      if (!data) throw new Error(`Unknown CID: ${cid}`);
      return new Uint8Array(data);
    },
  };
}

export async function putJson(store: BlobStore, value: unknown): Promise<string> {
  return store.put(encodeUtf8(stringify(value)));
}

export async function getJson<T>(store: BlobStore, cid: string): Promise<T> {
  const data = await store.get(cid);
  try {
    return parse<T>(decodeUtf8(data));
  } catch (e) {
    throw new Error(`Blob ${cid} is not zkClaim JSON: ${(e as Error).message}`);
  }
}
