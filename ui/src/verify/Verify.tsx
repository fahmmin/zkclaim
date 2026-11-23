// The wallet-free settlement check. It reads a receipt from the URL hash and checks it against the contract's public
// state on the indexer this build trusts. It imports nothing from the role app: no identities, wallet, private state
// or IPFS, only the design system's look.
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { Card, Data, Headline, Meta, Stamp } from '../zk/ds';
import { ANCHOR, type LedgerRead, NETWORK, readLedger, type ReadError, type Wire } from './ledger';
import { decodeReceipt, nightText, type Receipt, type Verdict, verify } from './receipt';

type Key = 'amount' | 'nullifier' | 'policy' | 'contract' | 'at' | 'net';
type Fields = Record<Key, string>;
type Outcome = { verdict: Verdict; receipt?: Receipt; read?: LedgerRead; wire?: Wire };

const FIELDS: { key: Key; label: string; hex?: boolean }[] = [
  { key: 'nullifier', label: 'Nullifier (the claim’s key on the ledger)', hex: true },
  { key: 'policy', label: 'Policy commitment', hex: true },
  { key: 'contract', label: 'Contract', hex: true },
  { key: 'at', label: 'Settlement time (Unix seconds)' },
  { key: 'net', label: 'Network' },
];

const fieldsOf = (hash: string): Fields => {
  const p = new URLSearchParams(hash.replace(/^#/, ''));
  return { amount: p.get('amount') ?? '', nullifier: p.get('nullifier') ?? '', policy: p.get('policy') ?? '', contract: p.get('contract') ?? '', at: p.get('at') ?? '', net: p.get('net') ?? '' };
};
const hashOf = (f: Fields) => new URLSearchParams({ v: '1', ...f }).toString();

const short = (h: string, head = 8, tail = 6) => (h.length <= head + tail + 1 ? h : `${h.slice(0, head)}…${h.slice(-tail)}`);
const when = (s: bigint) => new Date(Number(s) * 1000).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
const unknown = (reason: string): Outcome => ({ verdict: { result: 'unknown', reasons: [reason] } });

async function check(hash: string): Promise<Outcome> {
  const anchor = ANCHOR;
  if (!anchor) return unknown(`This page was built for the network "${NETWORK}", which has no trusted indexer.`);
  if (!hash.replace(/^#/, '')) return unknown('This link has no receipt in it. Get one from a paid claim in Live mode, or fill in the fields below.');
  let receipt: Receipt;
  try {
    receipt = decodeReceipt(hash);
  } catch (e) {
    return unknown(`This is not a valid receipt: ${e instanceof Error ? e.message : String(e)}.`);
  }
  const { verdict, read, error } = await verify(receipt, anchor, () => readLedger(anchor, receipt.contract, receipt.nullifier));
  return { verdict, receipt, read, wire: read?.wire ?? (error as ReadError | undefined)?.wire };
}

export default function Verify() {
  const [original, setOriginal] = useState(() => fieldsOf(location.hash));
  const [fields, setFields] = useState(original);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const seq = useRef(0);

  const run = async (hash: string) => {
    const mine = ++seq.current;
    setOutcome(null);
    const got = await check(hash);
    if (mine === seq.current) setOutcome(got); // a later check wins
  };

  useEffect(() => {
    const load = () => {
      const f = fieldsOf(location.hash);
      setOriginal(f);
      setFields(f);
      void run(location.hash);
    };
    load();
    addEventListener('hashchange', load);
    return () => removeEventListener('hashchange', load);
  }, []);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run(hashOf(fields));
  };

  return (
    <div className="zk verify">
      <header className="top">
        <span className="brand">ZKCLAIM</span>
        <span className="center">Settlement check</span>
        <div className="right">
          <span>No wallet needed</span>
        </div>
      </header>
      <main className="page">
        <div className="bento">
          <VerdictCard outcome={outcome} />
          <ReceiptForm fields={fields} original={original} busy={!outcome} onChange={setFields} onSubmit={submit} onRestore={() => (setFields(original), void run(hashOf(original)))} />
          <Trust />
          <OnTheWire outcome={outcome} />
        </div>
      </main>
      <footer className="foot">
        <span>
          Network: <Data>{NETWORK}</Data>
        </span>
        <span className="grow" />
        <span>Public data only. No wallet, no IPFS, nothing from this browser’s storage.</span>
      </footer>
    </div>
  );
}

const LOOK = {
  match: { tone: 'leaf', stamp: 'Matches', title: 'The ledger holds this payout' },
  mismatch: { tone: 'tomato', stamp: 'Does not match', title: 'The ledger says otherwise' },
  unknown: { tone: 'mustard', stamp: 'Cannot verify', title: 'This receipt could not be checked' },
} as const;

function VerdictCard({ outcome }: { outcome: Outcome | null }) {
  if (!outcome)
    return (
      <Card tone="paper" className="s12 verdict" aria-live="polite">
        <Meta>
          <span>Settlement check</span>
          <span>{ANCHOR?.label}</span>
        </Meta>
        <Headline size="l">Reading the ledger…</Headline>
        <div className="progress" aria-label="Reading the ledger">
          <i style={{ width: '70%' }} />
        </div>
      </Card>
    );
  const { verdict, receipt: r, read } = outcome;
  const look = LOOK[verdict.result];
  return (
    <Card tone={look.tone} className="s12 verdict" aria-live="polite">
      <Meta>
        <span>Settlement check</span>
        <span>{read?.block ? `${ANCHOR?.label}, block #${read.block.height}` : ANCHOR?.label}</span>
      </Meta>
      <div className="verdict-body">
        <Stamp slam tone="ink" rot={-7} className="verdict-stamp" sub={verdict.result === 'match' ? 'the ledger' : undefined}>
          {look.stamp}
        </Stamp>
        <div className="stack grow" style={{ gap: 10 }}>
          <Headline size="m">{look.title}</Headline>
          {verdict.result === 'match' && r ? (
            <>
              <div className="big-number">
                {nightText(r.amount, false)}
                <small>NIGHT</small>
              </div>
              <p className="lede">
                Paid on policy <Data title={r.policy}>{short(r.policy)}</Data> at {when(r.at)}, recorded by contract <Data title={r.contract}>{short(r.contract)}</Data>.
              </p>
              <p className="small">A match means the contract’s public state records this settlement. It is not an offline re-check of the zero-knowledge proof.</p>
            </>
          ) : (
            <ul className="plain reasons">
              {verdict.reasons.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Card>
  );
}

function ReceiptForm({
  fields,
  original,
  busy,
  onChange,
  onSubmit,
  onRestore,
}: {
  fields: Fields;
  original: Fields;
  busy: boolean;
  onChange: (f: Fields) => void;
  onSubmit: (e: FormEvent) => void;
  onRestore: () => void;
}) {
  const set = (k: Key, v: string) => onChange({ ...fields, [k]: v });
  const edited = (k: Key) => fields[k] !== original[k];
  const changed = (Object.keys(fields) as Key[]).some(edited);
  const units = /^\d{1,20}$/.test(fields.amount) ? BigInt(fields.amount) : null;
  return (
    <Card tone="paper" className="s7">
      <Meta>
        <span>The receipt</span>
        <span>Change any value, then check again</span>
      </Meta>
      <form className="stack" style={{ gap: 12 }} onSubmit={onSubmit}>
        <label className="field">
          <span>
            Amount paid, in base units {edited('amount') && <em className="edited">edited</em>}
          </span>
          <input className="amount" inputMode="numeric" autoComplete="off" spellCheck={false} value={fields.amount} onChange={(e) => set('amount', e.target.value.trim())} />
          <small>{units === null ? 'Not a whole number' : `= ${nightText(units)}`}</small>
        </label>
        {FIELDS.map((f) => (
          <label key={f.key} className="field">
            <span>
              {f.label} {edited(f.key) && <em className="edited">edited</em>}
            </span>
            {f.hex ? (
              <textarea className="hex" rows={2} spellCheck={false} value={fields[f.key]} onChange={(e) => set(f.key, e.target.value.replace(/\s/g, ''))} />
            ) : (
              <input autoComplete="off" spellCheck={false} value={fields[f.key]} onChange={(e) => set(f.key, e.target.value.trim())} />
            )}
            {f.key === 'at' && /^\d{1,12}$/.test(fields.at) && <small>= {when(BigInt(fields.at))}</small>}
          </label>
        ))}
        <div className="row">
          <button className="btn big" disabled={busy}>
            Check again
          </button>
          {changed && (
            <button type="button" className="btn ghost" disabled={busy} onClick={onRestore}>
              Back to the receipt
            </button>
          )}
        </div>
      </form>
    </Card>
  );
}

function Trust() {
  const a = ANCHOR;
  return (
    <Card tone="ink" className="s5">
      <Meta>
        <span>What this page trusts</span>
        <span>Fixed when it was built</span>
      </Meta>
      <Headline size="s">One indexer, chosen before any receipt arrived</Headline>
      <ul className="list">
        <li>
          <div className="grow">
            <b>Network</b>
            <div className="small">
              {a ? a.label : 'none'} (<Data>{NETWORK}</Data>)
            </div>
          </div>
        </li>
        <li>
          <div className="grow">
            <b>Indexer</b>
            <div className="small">
              <Data>{a ? new URL(a.indexer, location.href).href : 'none'}</Data>
              {a?.network === 'preprod' && <div>This site’s own function. It forwards the read to Blockfrost’s Midnight Preprod indexer and adds the project key on the server.</div>}
            </div>
          </div>
        </li>
        <li>
          <div className="grow">
            <b>Deployment</b>
            <div className="small">
              {a?.contract ? (
                <>
                  Pinned to <Data title={a.contract}>{short(a.contract)}</Data>. Receipts for any other contract do not match.
                </>
              ) : (
                'Not pinned: any contract on this network. Compare the contract in the receipt with the deployment the team published.'
              )}
            </div>
          </div>
        </li>
      </ul>
      <p className="small">A receipt only says what to look up. It cannot name another indexer or network. Nothing is read from a wallet, IPFS or this browser’s storage.</p>
    </Card>
  );
}

/** The response with the (long) contract state cut short, for reading; the full text is one click away. */
function shortened(body: string): string {
  try {
    const json = JSON.parse(body) as { data?: { contractAction?: { state?: string } | null } };
    const action = json.data?.contractAction;
    if (action?.state && action.state.length > 96) action.state = `${action.state.slice(0, 64)}… (${(action.state.length / 2).toLocaleString('en-US')} bytes of public contract state)`;
    return JSON.stringify(json, null, 2);
  } catch {
    return body || '(empty)';
  }
}

function decoded(o: Outcome): string {
  const { read, receipt: r } = o;
  if (!read || !r) return '';
  if (read.address === null) return 'contractAction = null: no contract at this address';
  const c = read.claim;
  return [
    c
      ? `claims.lookup(${r.nullifier}) = {\n  policy: ${c.policy},\n  amount: ${c.amount},   // ${nightText(c.amount)}\n  at: ${c.at}   // ${when(c.at)}\n}`
      : `claims.member(${r.nullifier}) = false`,
    `claims.size() = ${read.claims}`,
    `totalPaid = ${read.totalPaid}   // ${nightText(read.totalPaid)}`,
    read.block ? `state as of block #${read.block.height} (${read.block.hash}), protocol ${read.block.protocolVersion}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

function OnTheWire({ outcome }: { outcome: Outcome | null }) {
  const wire = outcome?.wire;
  return (
    <Card tone="ink" className="s12 wire">
      <Meta>
        <span>On the wire</span>
        <span>{wire ? `${wire.status ? `HTTP ${wire.status}` : 'No answer'}, ${wire.ms} ms` : 'Nothing sent'}</span>
      </Meta>
      <Headline size="s">What this page asked for, and what came back</Headline>
      {!wire ? (
        <p className="small">{outcome ? 'No request was made: this receipt was decided before reading the ledger.' : 'Waiting for the indexer…'}</p>
      ) : (
        <>
          <div className="grid2">
            <div className="field">
              <span>Request: POST {wire.endpoint}</span>
              <pre>{JSON.stringify(JSON.parse(wire.request), null, 2)}</pre>
            </div>
            <div className="field">
              <span>Response</span>
              <pre>{shortened(wire.body)}</pre>
              {wire.body && (
                <details>
                  <summary>Full response, {wire.body.length.toLocaleString('en-US')} characters</summary>
                  <pre>{wire.body}</pre>
                </details>
              )}
            </div>
          </div>
          {outcome?.read && (
            <div className="field">
              <span>Decoded with the contract’s own ledger()</span>
              <pre>{decoded(outcome)}</pre>
            </div>
          )}
          {outcome?.read?.address && (
            <p className="small">
              The answer is the contract’s whole public state, the bytes anyone on the network can read: commitments, hashes, public keys and the addresses of sealed (encrypted) files. It holds no name, diagnosis, procedure, prescription, card code, secret key or witness.
            </p>
          )}
        </>
      )}
    </Card>
  );
}
