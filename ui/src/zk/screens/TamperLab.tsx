import { useState } from 'react';
import { Daisy } from '../art';
import { Card, Headline, Meta, Stamp, type Tone } from '../ds';
import { type Attack, type AttackResult, ATTACKS, runAttack } from '../tamper';

const TONES: Tone[] = ['tomato', 'mustard', 'teal', 'paper', 'orange', 'leaf', 'cobalt', 'purple'];
const STAMP: Partial<Record<Tone, 'ink' | 'paper'>> = { tomato: 'ink', orange: 'ink', cobalt: 'paper', purple: 'paper' };

type State = Record<string, AttackResult | 'running'>;

export default function TamperLab() {
  const [results, setResults] = useState<State>({});
  const runnable = ATTACKS;
  const rejected = runnable.filter((a) => {
    const r = results[a.id];
    return r && r !== 'running' && r.ok;
  }).length;

  const run = async (a: Attack) => {
    setResults((r) => ({ ...r, [a.id]: 'running' }));
    const res = await runAttack(a);
    setResults((r) => ({ ...r, [a.id]: res }));
  };
  const runAll = async () => {
    for (const a of runnable) await run(a);
  };

  return (
    <div className="stack">
      <Card tone="purple" className="lab-head">
        <Meta>
          <span>Fresh contract per attack</span>
          <span>
            {rejected} of {runnable.length} rejected
          </span>
        </Meta>
        <Headline size="xl" className="up">
          <span className="ring-word">Tamper</span> Lab
        </Headline>
        <div className="row">
          <p className="lede grow">
            Every way we could think of to cheat a claim. Each runs on its own copy of the contract in this tab, and what you see is the contract's own rejection.
          </p>
          <button className="btn big light" onClick={runAll} disabled={Object.values(results).includes('running')}>
            Run all attacks
          </button>
        </div>
      </Card>
      <div className="attacks">
        {ATTACKS.map((a, i) => (
          <AttackCard key={a.id} attack={a} tone={TONES[i % TONES.length]} result={results[a.id]} onRun={() => run(a)} />
        ))}
      </div>
    </div>
  );
}

function AttackCard({ attack: a, tone, result, onRun }: { attack: Attack; tone: Tone; result?: AttackResult | 'running'; onRun: () => void }) {
  const done = result && result !== 'running' ? result : null;
  return (
    <Card tone={tone} className="attack">
      <Meta>
        <span>{a.who}</span>
      </Meta>
      <Headline size="s">{a.title}</Headline>
      <p className="small">{a.story}</p>
      <div className="result">
        {done && (
          <>
            <p className="msg" role="status">
              {done.message}
            </p>
            <span className="small">{done.ok ? `Rejected in ${Math.max(1, Math.round(done.ms))} ms` : 'Unexpected result'}</span>
          </>
        )}
        <button className="btn sm" onClick={onRun} disabled={result === 'running'} style={{ alignSelf: 'flex-start' }}>
          {result === 'running' ? 'Running…' : done ? 'Run again' : 'Run attack'}
        </button>
      </div>
      {done?.ok && (
        <>
          <Stamp key={done.ms} slam tone={STAMP[tone] ?? 'red'} size={34} rot={-12} sub="by math">
            Rejected
          </Stamp>
          <Daisy face="dizzy" size={58} style={{ right: -14, top: -18 }} />
        </>
      )}
    </Card>
  );
}
