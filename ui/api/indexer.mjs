// Vercel function at /api/indexer: the Preprod verifier's trusted indexer. The build copies this file to dist/api/,
// and `vercel deploy ui/dist` runs every file in the deployment's api/ folder as a function.
// It forwards the receipt verifier's one GraphQL read to Blockfrost's Midnight Preprod indexer and adds the project
// key here, so the key never reaches a browser. Nothing else is forwarded: an open proxy would spend our quota.

/** Must equal QUERY in ../src/verify/receipt.ts (receipt.test.mjs checks). */
export const QUERY = 'query ZkClaimReceipt($address: HexEncoded!) { contractAction(address: $address) { __typename address state stateAt { height hash protocolVersion } } }';
const UPSTREAM = 'https://midnight-preprod.blockfrost.io/api/v0';

const reply = (status, message) =>
  new Response(JSON.stringify({ errors: [{ message }] }), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

export default {
  async fetch(request) {
    if (request.method !== 'POST') return reply(405, 'POST the receipt query');
    const key = process.env.BLOCKFROST_PROJECT_ID?.trim();
    if (!key) return reply(500, 'BLOCKFROST_PROJECT_ID is not set on this deployment');
    let body;
    try {
      body = JSON.parse(await request.text());
    } catch {
      return reply(400, 'The body is not JSON');
    }
    const address = body?.variables?.address;
    if (body?.query !== QUERY || typeof address !== 'string' || !/^[0-9a-f]{64}$/.test(address)) return reply(400, 'Only the zkClaim receipt query is forwarded');
    let res;
    try {
      res = await fetch(UPSTREAM, {
        method: 'POST',
        headers: { 'content-type': 'application/json', project_id: key },
        body: JSON.stringify({ query: QUERY, variables: { address } }),
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      return reply(502, 'Blockfrost did not answer');
    }
    return new Response(await res.text(), {
      status: res.status,
      headers: { 'content-type': res.headers.get('content-type') ?? 'application/json', 'cache-control': 'no-store' },
    });
  },
};
