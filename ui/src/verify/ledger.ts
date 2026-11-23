// The verifier's one read: the contract's public state from the indexer this build trusts, decoded with the
// contract's own ledger(). The anchor is fixed at build time; a receipt only names what to look up.
import { ContractState } from '@midnight-ntwrk/midnight-js-protocol/v9/compact-runtime';
import { ledger } from '@zkclaim/contract';
import { type Anchor, QUERY, type Read } from './receipt';

const ANCHORS: Record<string, Omit<Anchor, 'contract'>> = {
  undeployed: { network: 'undeployed', label: 'the local devnet', indexer: 'http://127.0.0.1:8088/api/v4/graphql' },
  // This site's own function (ui/api/indexer.mjs), which adds the Blockfrost key on the server.
  preprod: { network: 'preprod', label: 'Midnight Preprod', indexer: '/api/indexer' },
};

/** The build's network: the same VITE_NETWORK_ID the role app's live mode uses. */
export const NETWORK = import.meta.env.VITE_NETWORK_ID || 'undeployed';
/** Null when this build has no trusted indexer for its network. VITE_VERIFY_CONTRACT pins one deployment. */
export const ANCHOR: Anchor | null = ANCHORS[NETWORK] ? { ...ANCHORS[NETWORK], contract: import.meta.env.VITE_VERIFY_CONTRACT?.trim().toLowerCase() || null } : null;

/** What was sent and what came back, verbatim. */
export type Wire = { endpoint: string; request: string; status: number | null; body: string; ms: number };
export type Block = { height: number; hash: string; protocolVersion: number };
export type LedgerRead = Read & { wire: Wire; block: Block | null; claims: bigint; totalPaid: bigint };
export type ReadError = Error & { wire?: Wire };

type Answer = { data?: { contractAction?: { address?: string; state?: string; stateAt?: Block } | null }; errors?: { message?: string }[] };

const unhex = (h: string) => Uint8Array.from(h.match(/../g) ?? [], (x) => parseInt(x, 16));
const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
const text = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function readLedger(a: Anchor, contract: string, nullifier: string): Promise<LedgerRead> {
  const request = JSON.stringify({ query: QUERY, variables: { address: contract } });
  const wire: Wire = { endpoint: new URL(a.indexer, location.href).href, request, status: null, body: '', ms: 0 };
  const fail = (message: string): ReadError => Object.assign(new Error(message), { wire });
  const started = performance.now();
  try {
    const res = await fetch(a.indexer, { method: 'POST', headers: { 'content-type': 'application/json' }, body: request, signal: AbortSignal.timeout(15_000) });
    wire.status = res.status;
    wire.body = await res.text();
  } catch (e) {
    throw fail(`${wire.endpoint} did not answer (${text(e)})`);
  } finally {
    wire.ms = Math.round(performance.now() - started);
  }
  if (wire.status !== 200) throw fail(`the indexer answered HTTP ${wire.status}`);
  let answer: Answer;
  try {
    answer = JSON.parse(wire.body);
  } catch {
    throw fail('the indexer answer is not JSON');
  }
  if (answer.errors?.length) throw fail(`the indexer reported "${answer.errors.map((e) => e.message).join('; ')}"`);
  const action = answer.data?.contractAction;
  if (action === undefined) throw fail('the indexer answer has no contractAction');
  if (action === null) return { address: null, claim: null, wire, block: null, claims: 0n, totalPaid: 0n };
  if (typeof action.state !== 'string' || !/^(?:[0-9a-f]{2})+$/i.test(action.state)) throw fail('the contract state is not hex');
  let l: ReturnType<typeof ledger>;
  try {
    l = ledger(ContractState.deserialize(unhex(action.state)).data);
  } catch (e) {
    throw fail(`the contract state is not a zkClaim ledger (${text(e)})`);
  }
  const n = unhex(nullifier);
  const s = l.claims.member(n) ? l.claims.lookup(n) : null;
  return {
    address: String(action.address ?? '').toLowerCase(),
    claim: s && { policy: hex(s.policy), amount: s.amount, at: s.at },
    wire,
    block: action.stateAt ?? null,
    claims: l.claims.size(),
    totalPaid: l.totalPaid,
  };
}
