import { describe, expect, it } from 'vitest';
import { getJson, kuboStore, memoryStore, putJson } from '../index.js';

const hello = new TextEncoder().encode('hello');
// `ipfs add --cid-version=1` of the 5 bytes "hello".
const HELLO_CID = 'bafkreibm6jg3ux5qumhcn2b3flc3tyu6dmlb4xa7u5bf44yegnrjhc4yeq';

describe('memoryStore', () => {
  it('round-trips bytes under the CID Kubo would give them', async () => {
    const store = memoryStore();
    expect(await store.put(hello)).toBe(HELLO_CID);
    expect(await store.get(HELLO_CID)).toEqual(hello);
    await expect(store.get('bafkreiunknown')).rejects.toThrow('Unknown CID');
  });

  it('stores JSON with bigint and bytes', async () => {
    const store = memoryStore();
    const value = { amount: 400_000_000n, pk: new Uint8Array([1, 2, 3]), note: 'sealed' };
    expect(await getJson(store, await putJson(store, value))).toEqual(value);
    await expect(getJson(store, await store.put(new Uint8Array([0xff, 0xfe])))).rejects.toThrow('is not zkClaim JSON');
  });
});

const KUBO = 'http://127.0.0.1:5001';
const kuboUp = await fetch(`${KUBO}/api/v0/version`, { method: 'POST', signal: AbortSignal.timeout(1500) }).then(
  (r) => r.ok,
  () => false,
);

describe.skipIf(!kuboUp)('kuboStore against the node at 127.0.0.1:5001', () => {
  const store = kuboStore(KUBO);

  it('round-trips bytes with the same CID as memoryStore', async () => {
    expect(await store.put(hello)).toBe(HELLO_CID);
    const data = new TextEncoder().encode(`zkclaim test blob ${crypto.randomUUID()}`);
    const cid = await store.put(data);
    expect(cid).toBe(await memoryStore().put(data));
    expect(await store.get(cid)).toEqual(data);
    const value = { record: new Uint8Array(32).fill(5), amount: 1n };
    expect(await getJson(store, await putJson(store, value))).toEqual(value);
  });

  it('fails clearly on an unknown or malformed CID', async () => {
    const neverAdded = await memoryStore().put(new TextEncoder().encode(`never added ${crypto.randomUUID()}`));
    await expect(store.get(neverAdded)).rejects.toThrow('IPFS cat failed');
    await expect(store.get('not-a-cid')).rejects.toThrow('IPFS cat failed');
  });

  it('allows the UI origin by CORS and no other', async () => {
    const preflight = (origin: string) =>
      fetch(`${KUBO}/api/v0/add`, { method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': 'POST' } });
    for (const origin of ['http://localhost:5173', 'http://127.0.0.1:5173']) {
      expect((await preflight(origin)).headers.get('access-control-allow-origin')).toBe(origin);
    }
    expect((await preflight('http://evil.example')).headers.get('access-control-allow-origin')).toBeNull();
  });
});

it('kuboStore reports an unreachable node clearly', async () => {
  await expect(kuboStore('http://127.0.0.1:1').get(HELLO_CID)).rejects.toThrow('is not reachable');
});
