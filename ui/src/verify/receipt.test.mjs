// Receipt format, match rules and the Preprod proxy. Run: node --test ui/src/verify/receipt.test.mjs
// (Plain JS so the UI's type check, which has no Node types, never sees node:test. Node strips receipt.ts's types.)
import assert from 'node:assert/strict';
import { test } from 'node:test';
import proxy, { QUERY as FORWARDED } from '../../api/indexer.mjs';
import { decodeReceipt, encodeReceipt, judge, nightText, precheck, QUERY, receiptUrl, verify } from './receipt.ts';

const R = { network: 'undeployed', contract: 'a'.repeat(64), nullifier: 'b'.repeat(64), policy: 'c'.repeat(64), amount: 400_000_000n, at: 1_764_000_000n };
const ANCHOR = { network: 'undeployed', label: 'the local devnet', indexer: 'http://127.0.0.1:8088/api/v4/graphql', contract: null };
const LEDGER = { address: R.contract, claim: { policy: R.policy, amount: R.amount, at: R.at } };

test('a receipt survives the round trip and carries only the allowlisted fields', () => {
  const text = encodeReceipt({ ...R, holderName: 'Rohan Iyer', salt: 'ff', code: 'ZKC1.x' });
  assert.deepEqual([...new URLSearchParams(text).keys()], ['v', 'net', 'contract', 'nullifier', 'policy', 'amount', 'at']);
  assert.doesNotMatch(text, /Rohan|ZKC1|salt/);
  assert.deepEqual(decodeReceipt(`#${text}`), R);
});

test('the link carries the receipt in the hash, never the query string', () => {
  const url = new URL(receiptUrl(R, 'http://localhost:5173/#/hospital'));
  assert.equal(url.origin + url.pathname, 'http://localhost:5173/verify.html');
  assert.equal(url.search, '');
  assert.deepEqual(decodeReceipt(url.hash), R);
  assert.equal(new URL(receiptUrl(R, 'https://zkclaim.vercel.app/')).pathname, '/verify.html');
});

test('decoding accepts one of each field and nothing else', () => {
  const good = encodeReceipt(R);
  const cases = [
    [`${good}&indexer=https%3A%2F%2Fevil.example`, /"indexer" is not a receipt field/],
    [`${good}&amount=1`, /"amount" appears 2 times/],
    [good.replace(/&at=\d+/, ''), /"at" is missing/],
    [good.replace('v=1', 'v=2'), /version "2"/],
    [good.replace(R.contract, 'a'.repeat(63)), /"contract" must be 64 hex/],
    [good.replace(R.nullifier, 'z'.repeat(64)), /"nullifier" must be 64 hex/],
    [good.replace(/amount=\d+/, 'amount=-5'), /"amount" must be a whole number/],
    [good.replace(/amount=\d+/, 'amount=4.5'), /"amount"/],
    [good.replace(/amount=\d+/, `amount=${2n ** 64n}`), /"amount"/],
    [good.replace('net=undeployed', 'net=Pre%20prod'), /"net" is not a network id/],
    ['', /"v" is missing/],
  ];
  for (const [bad, why] of cases) assert.throws(() => decodeReceipt(bad), why, bad);
  assert.equal(decodeReceipt(good.replace(R.contract, R.contract.toUpperCase())).contract, R.contract);
  assert.equal(decodeReceipt(good.replace(/amount=\d+/, `amount=${2n ** 64n - 1n}`)).amount, 2n ** 64n - 1n);
});

test('precheck: another network is not checked here; a pinned build refuses other deployments', () => {
  assert.equal(precheck({ ...R, network: 'preprod' }, ANCHOR)?.result, 'unknown');
  assert.equal(precheck(R, { ...ANCHOR, contract: 'd'.repeat(64) })?.result, 'mismatch');
  assert.equal(precheck(R, { ...ANCHOR, contract: R.contract }), null);
  assert.equal(precheck(R, ANCHOR), null);
});

test('judge: exact ledger values match; one changed digit, another contract or a missing claim do not', () => {
  assert.equal(judge(R, LEDGER).result, 'match');
  const digit = judge({ ...R, amount: 400_000_001n }, LEDGER);
  assert.equal(digit.result, 'mismatch');
  assert.match(digit.reasons[0], /Amount: the receipt says 400000001, the ledger 400000000/);
  assert.equal(judge({ ...R, policy: 'd'.repeat(64) }, LEDGER).result, 'mismatch');
  assert.equal(judge({ ...R, at: R.at + 1n }, LEDGER).result, 'mismatch');
  assert.equal(judge(R, { address: null, claim: null }).result, 'mismatch');
  assert.equal(judge(R, { ...LEDGER, claim: null }).result, 'mismatch');
  assert.equal(judge(R, { ...LEDGER, address: 'e'.repeat(64) }).result, 'unknown');
});

test('verify: an unreachable indexer is "unknown", never a match', async () => {
  const down = await verify(R, ANCHOR, () => Promise.reject(new TypeError('Failed to fetch')));
  assert.equal(down.verdict.result, 'unknown');
  assert.match(down.verdict.reasons[0], /Could not read the ledger: Failed to fetch/);
  assert.equal((await verify(R, ANCHOR, async () => LEDGER)).verdict.result, 'match');
  let asked = false;
  const other = await verify({ ...R, network: 'preprod' }, ANCHOR, async () => ((asked = true), LEDGER));
  assert.equal(other.verdict.result, 'unknown');
  assert.equal(asked, false, 'a receipt for another network is never looked up');
});

test('NIGHT display is exact', () => {
  assert.equal(nightText(400_000_000n), '400 NIGHT');
  assert.equal(nightText(400n), '0.0004 NIGHT');
  assert.equal(nightText(1_250_500_000n, false), '1,250.5');
});

test('the Preprod proxy forwards only the receipt read, with the key added server-side', async () => {
  assert.equal(FORWARDED, QUERY);
  const saved = { fetch: globalThis.fetch, key: process.env.BLOCKFROST_PROJECT_ID };
  const calls = [];
  const post = (body) => proxy.fetch(new Request('https://zkclaim.vercel.app/api/indexer', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) }));
  try {
    globalThis.fetch = async (url, init) => (calls.push({ url, init }), new Response('{"data":{"contractAction":null}}', { headers: { 'content-type': 'application/json' } }));

    delete process.env.BLOCKFROST_PROJECT_ID;
    assert.equal((await post({ query: QUERY, variables: { address: R.contract } })).status, 500);

    process.env.BLOCKFROST_PROJECT_ID = ' nightpreprodTESTKEY ';
    const ok = await post({ query: QUERY, variables: { address: R.contract, extra: 1 }, operationName: 'x' });
    assert.equal(ok.status, 200);
    assert.equal(await ok.text(), '{"data":{"contractAction":null}}');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://midnight-preprod.blockfrost.io/api/v0');
    assert.equal(calls[0].init.headers.project_id, 'nightpreprodTESTKEY');
    assert.deepEqual(JSON.parse(calls[0].init.body), { query: QUERY, variables: { address: R.contract } });

    const refused = [
      await post({ query: '{ block { hash } }', variables: { address: R.contract } }),
      await post({ query: QUERY, variables: { address: 'x' } }),
      await post({ query: QUERY }),
      await post('not json'),
      await proxy.fetch(new Request('https://zkclaim.vercel.app/api/indexer')),
    ];
    assert.deepEqual(refused.map((r) => r.status), [400, 400, 400, 400, 405]);
    assert.equal(calls.length, 1, 'refused requests never reach Blockfrost');
    for (const r of refused) assert.doesNotMatch(await r.text(), /TESTKEY/);

    globalThis.fetch = async () => {
      throw new TypeError('fetch failed');
    };
    const down = await post({ query: QUERY, variables: { address: R.contract } });
    assert.equal(down.status, 502);
    assert.doesNotMatch(await down.text(), /TESTKEY/);
  } finally {
    globalThis.fetch = saved.fetch;
    if (saved.key === undefined) delete process.env.BLOCKFROST_PROJECT_ID;
    else process.env.BLOCKFROST_PROJECT_ID = saved.key;
  }
});
