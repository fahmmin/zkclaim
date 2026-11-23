import { useEffect, useState } from 'react';
import { Asterisk, Daisy, FlowerBadge, Pixel } from '../art';
import { attempt, Card, Data, Headline, Meta, Redact, Stamp } from '../ds';
import { type Claim, COSMETIC, date, fingerprint, night, parseNight, PROCEDURES, procedureShort, short, time } from '../service';
import { useService, useSnap } from '../ctx';
import { GetReceipt } from '../receipt';

/** Claims whose stamp already played; the slam runs once per claim per page load. */
const stamped = new Set<string>();

export default function Insurer() {
  return (
    <div className="bento">
      <ClaimsFeed />
      <Pool />
      <Hospitals />
      <IssuePolicy />
      <PolicyBook />
      <EmergencyAdmin />
    </div>
  );
}

function ClaimsFeed() {
  const s = useSnap();
  return (
    <Card tone="cobalt" className="s8 r3 feed">
      <Meta>
        <span>
          Kestrel Mutual
          <br />
          Claims desk
        </span>
        <span>
          {s.claims.length} settled
          <br />
          {night(s.paid)} paid
        </span>
      </Meta>
      <Headline size="xl" className="up">
        Claims
      </Headline>
      <div className="no-reject">
        <s aria-hidden="true">Reject claim</s>
        <p>There is no reject button. Settled by the contract. A valid proof can't be denied.</p>
      </div>
      {s.claims.length === 0 ? (
        <div className="empty">
          <Daisy face="worried" size={88} />
          <p>No claims yet. When a hospital's proof checks out, the claim lands here already paid.</p>
        </div>
      ) : (
        <div className="stack">
          {s.claims.map((c, i) => (
            <ClaimTile key={c.nullifier} claim={c} fresh={i === 0 && s.now - c.at < 120} />
          ))}
        </div>
      )}
      <FlowerBadge size={110} bg="mustard" ring="ink" petal="ink" className="feed-badge" />
    </Card>
  );
}

// Only what is actually hidden: the payee address is public (payouts are unshielded) and the insurer knows
// whose policy each fingerprint is, because it issued the card.
const NEVER: [string, number][] = [
  ['Diagnosis', 12],
  ['Procedure', 9],
  ['Prescriptions', 11],
  ['Lab results', 10],
  ['Medical record', 14],
];

function ClaimTile({ claim: c, fresh }: { claim: Claim; fresh: boolean }) {
  const [slam] = useState(() => fresh && !stamped.has(c.nullifier));
  useEffect(() => {
    if (slam) stamped.add(c.nullifier);
  }, [slam, c.nullifier]);
  return (
    <article className={`claim ${slam ? 'fresh' : ''}`} aria-label={`Claim of ${night(c.amount)}, settled`}>
      <section>
        <div className="colhead">Insurer sees</div>
        <div className="big-number">
          {night(c.amount, false)}
          <small>NIGHT</small>
        </div>
        <dl>
          <dt>Policy</dt>
          <dd>
            <Data title={c.policy}>{fingerprint(c.policy)}</Data>
          </dd>
          <dt>Nullifier</dt>
          <dd>
            <Data title={c.nullifier}>{short(c.nullifier, 10, 6)}</Data>
          </dd>
          <dt>Hospital list</dt>
          <dd>
            <Data title={c.hospitalRoot}>root {short(c.hospitalRoot, 8, 4)}</Data>
          </dd>
          <dt>Paid to</dt>
          <dd>
            <Data title={c.payTo ?? ''}>{c.payTo ? short(c.payTo, 8, 4) : 'in the transaction'}</Data>
          </dd>
          <dt>Settled</dt>
          <dd>
            <Data>
              {time(c.at)} {date(c.at)}
            </Data>
          </dd>
        </dl>
        <GetReceipt claim={c} />
      </section>
      <section className="never">
        <div className="colhead">Insurer never sees</div>
        <dl>
          {NEVER.map(([label, w]) => (
            <div key={label} style={{ display: 'contents' }}>
              <dt>{label}</dt>
              <dd>
                <Redact w={w} />
              </dd>
            </div>
          ))}
        </dl>
        <p className="small muted">Proved, not shown.</p>
      </section>
      <Stamp className="paid-stamp" slam={slam} rot={-8} sub="by the contract">
        Paid
      </Stamp>
    </article>
  );
}

function Pool() {
  const s = useSnap();
  const svc = useService();
  const [amount, setAmount] = useState('10,000');
  const units = parseNight(amount);
  return (
    <Card tone="mustard" className="s4">
      <Meta>
        <span>Payout pool</span>
        <span>Held by the contract</span>
      </Meta>
      <div className="big-number">
        {night(s.funded - s.paid, false)}
        <small>NIGHT</small>
      </div>
      <p className="small">
        Funded {night(s.funded)}. Paid out {night(s.paid)}. Claims draw from here automatically.
      </p>
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          if (units) void attempt(() => svc.fundPool(units), `Pool funded with ${night(units)}`);
        }}
      >
        <label className="field grow">
          <span>Amount in NIGHT</span>
          <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} aria-invalid={!units} />
        </label>
        <button className="btn" disabled={!units || !!s.busy} style={{ alignSelf: 'flex-end' }}>
          Fund pool
        </button>
      </form>
    </Card>
  );
}

function Hospitals() {
  const s = useSnap();
  const svc = useService();
  return (
    <Card tone="teal" className="s4">
      <Meta>
        <span>Approved hospitals</span>
        <span>
          List root <Data>{short(s.hospitalRoot, 6, 4)}</Data>
        </span>
      </Meta>
      <ul className="list">
        {s.hospitals.map((h) => (
          <li key={h.id}>
            <Pixel art="hospital" scale={2} />
            <div className="grow">
              <b>{h.name}</b>
              <div className="small">{h.approved ? `On the list, leaf ${h.index}` : h.note}</div>
            </div>
            {h.approved ? (
              <button className="btn sm ghost" disabled={!!s.busy} onClick={() => attempt(() => svc.removeHospital(h.id), `${h.name} removed. Its old proofs stop working.`)}>
                Remove
              </button>
            ) : (
              <button className="btn sm" disabled={!!s.busy} onClick={() => attempt(() => svc.approveHospital(h.id), `${h.name} approved`)}>
                Approve
              </button>
            )}
          </li>
        ))}
      </ul>
      <p className="small">Hospitals prove they are on this list without saying which one they are.</p>
    </Card>
  );
}

const PLANS = ['Gold Family', 'Silver Care', 'Basic Shield'];

function IssuePolicy() {
  const s = useSnap();
  const svc = useService();
  const [name, setName] = useState('Rohan Iyer');
  const [plan, setPlan] = useState(PLANS[0]);
  const [limit, setLimit] = useState('5,000');
  const [days, setDays] = useState(365);
  const [covered, setCovered] = useState<number[]>(() => PROCEDURES.filter((p) => p.code !== COSMETIC).map((p) => p.code));
  const units = parseNight(limit);
  const toggle = (code: number) => setCovered((c) => (c.includes(code) ? c.filter((x) => x !== code) : [...c, code].slice(0, 8)));
  return (
    <Card tone="paper" className="s5">
      <Meta>
        <span>New policy</span>
        <span>Sealed to the patient's phone</span>
      </Meta>
      <Headline size="m">Issue a card</Headline>
      <form
        className="stack"
        style={{ gap: 12 }}
        onSubmit={(e) => {
          e.preventDefault();
          if (units) void attempt(() => svc.issuePolicy({ holderName: name, plan, limit: units, validDays: days, covered }), `Card issued to ${name}. It is on their phone now.`);
        }}
      >
        <div className="grid2">
          <label className="field">
            <span>Policy holder</span>
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="field">
            <span>Plan</span>
            <select value={plan} onChange={(e) => setPlan(e.target.value)}>
              {PLANS.map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Limit in NIGHT</span>
            <input inputMode="decimal" value={limit} onChange={(e) => setLimit(e.target.value)} aria-invalid={!units} />
          </label>
          <div className="field">
            <span>Valid for</span>
            <div className="chips">
              {[
                [30, '30 days'],
                [365, '1 year'],
              ].map(([d, label]) => (
                <button type="button" key={d} className="chip" aria-pressed={days === d} onClick={() => setDays(Number(d))}>
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="field">
          <span>Covered procedures</span>
          <div className="chips">
            {PROCEDURES.map((p) => (
              <button type="button" key={p.code} className="chip" aria-pressed={covered.includes(p.code)} onClick={() => toggle(p.code)}>
                {procedureShort(p.code)}
              </button>
            ))}
          </div>
        </div>
        <button className="btn big" disabled={!units || covered.length === 0 || !!s.busy}>
          Issue card to {name.split(' ')[0] || 'patient'}
        </button>
      </form>
    </Card>
  );
}

function PolicyBook() {
  const s = useSnap();
  return (
    <Card tone="purple" className="s3">
      <Meta>
        <span>Policy book</span>
        <span>{s.policies.length} issued</span>
      </Meta>
      {s.policies.length === 0 ? (
        <p className="small">No cards issued yet.</p>
      ) : (
        <ul className="list">
          {s.policies.map((p) => (
            <li key={p.fingerprint}>
              <div className="grow">
                <b>{p.holderName}</b>
                <div className="small">
                  {p.plan}, until {date(p.expiresAt)}
                </div>
                <Data title={p.fingerprint}>{fingerprint(p.fingerprint)}</Data>
              </div>
            </li>
          ))}
        </ul>
      )}
      <p className="small">On-chain, each card is only its fingerprint. The terms travel on the card.</p>
    </Card>
  );
}

function EmergencyAdmin() {
  const s = useSnap();
  const svc = useService();
  return (
    <Card tone="tomato" className="s4">
      <Meta>
        <span>Emergency access</span>
        <span>Responders</span>
      </Meta>
      <div className="row">
        <Headline size="s" className="grow">
          Responders
        </Headline>
        <Pixel art="siren" scale={3} />
      </div>
      <div className="row">
        <span className="grow small">
          {s.emergencyKey ? (
            <>
              Emergency key <Data>{short(s.emergencyKey, 6, 4)}</Data>, fixed at deploy. Every record is also sealed to it.
            </>
          ) : (
            'This contract has no emergency key.'
          )}
        </span>
      </div>
      <ul className="list">
        {s.responders.map((r) => (
          <li key={r.id}>
            <Asterisk size={18} />
            <div className="grow">
              <b>{r.name}</b>
              <div className="small">{r.approved ? 'Can break the glass' : 'Not approved'}</div>
            </div>
            <button className={`btn sm ${r.approved ? 'ghost' : ''}`} disabled={!!s.busy} onClick={() => attempt(() => svc.setResponder(r.id, !r.approved))}>
              {r.approved ? 'Remove' : 'Approve'}
            </button>
          </li>
        ))}
      </ul>
    </Card>
  );
}
