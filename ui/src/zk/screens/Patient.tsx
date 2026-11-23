import { type HTMLAttributes, useState } from 'react';
import { Daisy, FlowerBadge, Pixel, type Sprite } from '../art';
import { attempt, Card, Data, Headline, Meta, QR, Stamp, toast } from '../ds';
import {
  type AuditEntry,
  date,
  fingerprint,
  type GranteeRole,
  type MedicalRecord,
  night,
  procedureShort,
  ROLE_SECTIONS,
  ROLE_TITLES,
  SECTION_TITLES,
  short,
  time,
  until,
} from '../service';
import { useService, useSnap } from '../ctx';

type Slot = HTMLAttributes<HTMLElement>;

const TABS: { id: string; label: string; icon: Sprite }[] = [
  { id: 'card', label: 'Card', icon: 'shield' },
  { id: 'records', label: 'Records', icon: 'floppy' },
  { id: 'access', label: 'Access', icon: 'key' },
  { id: 'trail', label: 'Trail', icon: 'lock' },
];

export const copy = (text: string, what: string) =>
  navigator.clipboard.writeText(text).then(
    () => toast(`${what} copied`),
    () => toast('Copying is blocked here; select the text instead', true),
  );

export default function Patient({ tab }: { tab: string }) {
  const s = useSnap();
  const t = TABS.some((x) => x.id === tab) ? tab : 'card';
  // On phones only the current tab's cards show; on laptops the whole bento does.
  const on = (...tabs: string[]) => ({ 'data-tab': '', 'data-tab-on': tabs.includes(t) ? '' : undefined });
  const mine = s.records.filter((r) => r.mine);
  const pending = mine.filter((r) => r.status === 'anchored' && !r.withdrawn).length;
  const alarms = s.audit.filter((a) => a.kind === 'breakGlass' && mine.some((r) => r.id === a.record)).length;
  return (
    <>
      <div className="bento">
        <PolicyCardView className="s7" {...on('card')} />
        <Consent className="s5" {...on('card', 'records')} />
        <Records className="s7" {...on('records')} />
        <Access className="s5" {...on('access')} />
        <Trail className="s12" {...on('trail')} />
      </div>
      <nav className="tabbar" aria-label="Patient app">
        {TABS.map((x) => (
          <a key={x.id} href={`#/patient${x.id === 'card' ? '' : '/' + x.id}`} aria-current={t === x.id ? 'page' : undefined}>
            <Pixel art={x.icon} scale={1.5} />
            {x.label}
            {x.id === 'records' && pending > 0 && <span className="badge">{pending}</span>}
            {x.id === 'trail' && alarms > 0 && <span className="badge">!</span>}
          </a>
        ))}
      </nav>
    </>
  );
}

function PolicyCardView({ className, ...rest }: Slot) {
  const s = useSnap();
  const [showing, setShowing] = useState(false);
  const card = s.card;
  if (!card)
    return (
      <Card tone="paper" className={className} {...rest}>
        <Meta>
          <span>Policy card</span>
          <span>Nothing here yet</span>
        </Meta>
        <div className="empty">
          <Daisy face="worried" size={96} />
          <p>No card yet. When your insurer issues your policy, it lands here, sealed to this phone.</p>
        </div>
      </Card>
    );
  const used = s.claims.filter((c) => c.policy === card.fingerprint).reduce((a, c) => a + c.amount, 0n);
  return (
    <Card tone="paper" className={`${className} policy-card`} {...rest}>
      <Meta>
        <span>Kestrel Mutual</span>
        <span>Policy card</span>
      </Meta>
      <div className="idcard">
        <div className="photo" aria-hidden="true">
          <Daisy face="happy" size={124} className="face" />
          <span className="tag">Insured</span>
        </div>
        <div className="stack id-head" style={{ gap: 12 }}>
          <h2 className="name">{card.holderName}</h2>
          <p className="small">{card.plan} plan. Show this card at an approved hospital: it proves your claim without your insurer ever seeing your records.</p>
        </div>
        <dl className="ruled id-fields">
            <div>
              <dt>Policy no</dt>
              <dd>{card.policyNo}</dd>
            </div>
            <div>
              <dt>Valid till</dt>
              <dd>{date(card.expiresAt)}</dd>
            </div>
            <div>
              <dt>Limit</dt>
              <dd>{night(card.limit)}</dd>
            </div>
            <div>
              <dt>Fingerprint</dt>
              <dd className="data">{fingerprint(card.fingerprint)}</dd>
            </div>
            <div>
              <dt>Used</dt>
              <dd>{night(used)}</dd>
            </div>
            <div>
              <dt>Holder id</dt>
              <dd className="data">{short(card.holderPk, 4, 4)}</dd>
            </div>
        </dl>
      </div>
      <div className="field">
        <span>Covered</span>
        <div className="chips">
          {card.covered.map((code) => (
            <span key={code} className="chip">
              {procedureShort(code)}
            </span>
          ))}
        </div>
      </div>
      <div className="row card-actions">
        <QR text={card.code} size={104} label="Policy card QR code" />
        <div className="stack grow" style={{ gap: 8 }}>
          <button className="btn big" onClick={() => setShowing(true)}>
            Show to hospital
          </button>
          <button className="btn ghost sm" onClick={() => copy(card.code, 'Card code')}>
            Copy card code
          </button>
        </div>
      </div>
      {showing && (
        <div className="qr-overlay" role="dialog" aria-label="Policy card QR" onClick={() => setShowing(false)}>
          <Card tone="paper" onClick={(e) => e.stopPropagation()}>
            <Meta>
              <span>{card.holderName}</span>
              <span>{fingerprint(card.fingerprint)}</span>
            </Meta>
            <Headline size="m">Let the hospital scan this</Headline>
            <QR text={card.code} size={320} label="Policy card QR code" />
            <p className="small">It carries your policy terms, not your medical history.</p>
            <div className="row">
              <button className="btn ghost" onClick={() => copy(card.code, 'Card code')}>
                Copy code
              </button>
              <button className="btn" onClick={() => setShowing(false)}>
                Done
              </button>
            </div>
          </Card>
        </div>
      )}
    </Card>
  );
}

/**
 * The patient's say over each unpaid claim: give permission, or take it back. Both are the same big button. Given /
 * paid come from the chain (consent tag, settled claim); "withdrawn" is this phone remembering it took it back.
 */
function Consent({ className, ...rest }: Slot) {
  const s = useSnap();
  const svc = useService();
  const [pick, setPick] = useState('');
  const [withdrawing, setWithdrawing] = useState<string | null>(null);
  const mine = s.records.filter((r) => r.mine);
  const open = mine.filter((r) => r.status !== 'paid');
  const r = open.find((x) => x.id === pick) ?? open.find((x) => x.status === 'anchored' && !x.withdrawn) ?? open[0];
  const latest = mine[0];
  if (!r)
    return (
      <Card tone="mustard" className={`${className} consent`} {...rest}>
        <Meta>
          <span>Claims</span>
          <span>{latest ? latest.hospitalName : 'All quiet'}</span>
        </Meta>
        {latest?.status === 'paid' ? (
          <>
            <Headline size="l">Paid. You owe nothing.</Headline>
            <p className="lede">
              {night(latest.amount)} went straight from the pool to {latest.hospitalName}. Nobody at the insurer read your file.
            </p>
            <Stamp tone="cobalt" size={70} rot={-7} sub="by the contract" style={{ alignSelf: 'flex-start' }}>
              Paid
            </Stamp>
          </>
        ) : (
          <>
            <Headline size="l">Nothing to sign</Headline>
            <p className="lede">When a hospital asks to claim from your policy, the request shows up here for your OK.</p>
          </>
        )}
      </Card>
    );

  const given = r.status === 'consented';
  const pending = withdrawing === r.id;
  const withdraw = async () => {
    setWithdrawing(r.id);
    try {
      await svc.withdrawConsent(r.id);
      toast("Permission withdrawn: the hospital can't settle this bill");
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      // Settlement got there first. Say so plainly, and promise nothing about getting it back.
      toast(m.includes('Claim already settled') ? 'Already paid: the hospital settled this bill first' : m, true);
    } finally {
      setWithdrawing(null);
    }
  };
  return (
    <Card tone="mustard" className={`${className} consent`} {...rest}>
      <Meta>
        <span>Claim request</span>
        <span>{r.hospitalName}</span>
      </Meta>
      {open.length > 1 && (
        <select value={r.id} onChange={(e) => setPick(e.target.value)} aria-label="Which claim">
          {open.map((x) => (
            <option key={x.id} value={x.id}>
              {x.procedure.name}, {night(x.amount)}: {x.status === 'consented' ? 'permission given' : x.withdrawn ? 'withdrawn' : 'needs your OK'}
            </option>
          ))}
        </select>
      )}
      <Headline size="l">{pending ? 'Withdrawal pending' : given ? 'Permission given' : r.withdrawn ? 'Permission withdrawn' : 'Consent to this claim?'}</Headline>
      <p className="lede">
        {r.withdrawn && !given ? (
          <>{r.hospitalName} can't settle this bill. You can give permission again.</>
        ) : (
          <>
            {r.hospitalName} asks to settle this bill only: <b>{night(r.amount)}</b> for your visit on {date(r.createdAt)}.
          </>
        )}
      </p>
      <div className="promise">
        <Pixel art="lock" scale={4} />
        <p>
          Kestrel Mutual receives your policy fingerprint, the amount and the time. <b>Never your diagnosis, procedure, prescriptions, lab results or records.</b> Lasts until
          paid or withdrawn.
        </p>
      </div>
      {given ? (
        <button className="btn big block" disabled={!!s.busy} onClick={withdraw}>
          {pending ? 'Withdrawal pending…' : 'Withdraw permission'}
        </button>
      ) : (
        <button className="btn big block" disabled={!!s.busy} onClick={() => attempt(() => svc.consent(r.id), 'Permission given. The hospital can prove the claim now.')}>
          {r.withdrawn ? 'Give permission again' : 'Consent to this claim'}
        </button>
      )}
      <Daisy face={given ? 'happy' : 'smile'} size={96} style={{ right: -18, top: -28 }} />
    </Card>
  );
}

function Records({ className, ...rest }: Slot) {
  const s = useSnap();
  const mine = s.records.filter((r) => r.mine);
  const [open, setOpen] = useState<string | null>(null);
  return (
    <Card tone="teal" className={className} {...rest}>
      <Meta>
        <span>My records</span>
        <span>Decrypted on this phone</span>
      </Meta>
      <Headline size="m">Records</Headline>
      {mine.length === 0 ? (
        <p className="small">No records yet. When a hospital seals a record to you, this phone finds it and opens it here.</p>
      ) : (
        <ul className="list">
          {mine.map((r) => (
            <li key={r.id} style={{ flexWrap: 'wrap' }}>
              <Pixel art="floppy" scale={2.5} />
              <div className="grow">
                <b>{r.procedure.name}</b>
                <div className="small">
                  {r.hospitalName}, {date(r.createdAt)}, {night(r.amount)}
                </div>
              </div>
              <StatusChip r={r} />
              <button className="btn sm ghost" aria-expanded={open === r.id} onClick={() => setOpen(open === r.id ? null : r.id)}>
                {open === r.id ? 'Close' : 'Open'}
              </button>
              {open === r.id && <Sections record={r} visible={ROLE_SECTIONS.owner} />}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export function StatusChip({ r }: { r: MedicalRecord }) {
  return r.status === 'paid' ? (
    <span className="chip ok">Paid</span>
  ) : r.status === 'consented' ? (
    <span className="chip solid">Consented</span>
  ) : r.withdrawn ? (
    <span className="chip red">Withdrawn</span>
  ) : (
    <span className="chip warn">Awaiting consent</span>
  );
}

export function Sections({ record, visible }: { record: Pick<MedicalRecord, 'sections'>; visible: string[] }) {
  return (
    <div className="sections" style={{ width: '100%' }}>
      {(Object.keys(SECTION_TITLES) as (keyof typeof SECTION_TITLES)[]).map((name) =>
        visible.includes(name) ? (
          <div key={name} className="section">
            <h4>{SECTION_TITLES[name]}</h4>
            <ul>
              {(record.sections[name] ?? []).map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
        ) : (
          <div key={name} className="section locked">
            <h4>{SECTION_TITLES[name]}</h4>
            <p className="small">Not shared with you.</p>
          </div>
        ),
      )}
    </div>
  );
}

const DURATIONS: [number, string][] = [
  [3600, '1 hour'],
  [86_400, '1 day'],
  [7 * 86_400, '1 week'],
];

function Access({ className, ...rest }: Slot) {
  const s = useSnap();
  const svc = useService();
  const mine = s.records.filter((r) => r.mine);
  const [recordId, setRecordId] = useState('');
  const [role, setRole] = useState<GranteeRole>('doctor');
  const [ttl, setTtl] = useState(86_400);
  const record = mine.find((r) => r.id === recordId) ?? mine[0];
  const grants = s.grants.filter((g) => g.role !== 'emergency' && mine.some((r) => r.id === g.record));
  return (
    <Card tone="purple" className={className} {...rest}>
      <Meta>
        <span>Who can see what</span>
        <span>Grants on-chain</span>
      </Meta>
      <Headline size="m">Access</Headline>
      {!record ? (
        <p className="small">Once you have a record, you can share parts of it with a doctor, a lab or a pharmacy, for as long as you choose.</p>
      ) : (
        <form
          className="stack"
          style={{ gap: 12 }}
          onSubmit={(e) => {
            e.preventDefault();
            void attempt(() => svc.grantAccess(record.id, role, ttl), `${s.people[role]} can see the ${ROLE_TITLES[role].toLowerCase()} view for ${DURATIONS.find(([d]) => d === ttl)?.[1]}`);
          }}
        >
          {mine.length > 1 && (
            <label className="field">
              <span>Record</span>
              <select value={record.id} onChange={(e) => setRecordId(e.target.value)}>
                {mine.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.procedure.name}, {date(r.createdAt)}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="field">
            <span>Share with</span>
            <div className="chips">
              {(['doctor', 'lab', 'pharmacy'] as GranteeRole[]).map((r) => (
                <button type="button" key={r} className="chip" aria-pressed={role === r} onClick={() => setRole(r)}>
                  {s.people[r]}
                </button>
              ))}
            </div>
            <span className="small" style={{ fontWeight: 500 }}>
              They will see: {ROLE_SECTIONS[role].map((x) => SECTION_TITLES[x].toLowerCase()).join(', ')}.
            </span>
          </div>
          <div className="field">
            <span>For</span>
            <div className="chips">
              {DURATIONS.map(([d, label]) => (
                <button type="button" key={d} className="chip" aria-pressed={ttl === d} onClick={() => setTtl(d)}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          <button className="btn light" disabled={!!s.busy}>
            Grant access
          </button>
        </form>
      )}
      {grants.length > 0 && (
        <ul className="list">
          {grants.map((g) => {
            const state = g.revokedAt !== null ? 'Revoked' : (g.expiresAt ?? 0) <= s.now ? 'Expired' : until(g.expiresAt!, s.now);
            return (
              <li key={`${g.record}-${g.role}`}>
                <div className="grow">
                  <b>{g.grantee}</b>
                  <div className="small">
                    {ROLE_TITLES[g.role]}, {state}
                  </div>
                </div>
                {g.revokedAt === null && (g.expiresAt ?? 0) > s.now && (
                  <button className="btn sm light" disabled={!!s.busy} onClick={() => attempt(() => svc.revokeAccess(g.record, g.role as GranteeRole), `${g.grantee} can't open it any more`)}>
                    Revoke
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

const KIND: Record<AuditEntry['kind'], string> = { granted: 'Granted', revoked: 'Revoked', viewed: 'Viewed', breakGlass: 'Break-glass' };

export function TrailList({ entries, empty }: { entries: AuditEntry[]; empty: string }) {
  if (entries.length === 0) return <p className="small">{empty}</p>;
  return (
    <ol className="trail">
      {entries.map((a, i) => (
        <li key={`${a.at}-${i}`} className={a.kind === 'breakGlass' ? 'alarm' : ''}>
          <span className="kind">{KIND[a.kind]}</span>
          <span>
            <b>{a.actor}</b>
            <span className="small"> {a.detail}</span>
          </span>
          <Data>{time(a.at)}</Data>
        </li>
      ))}
    </ol>
  );
}

function Trail({ className, ...rest }: Slot) {
  const s = useSnap();
  const mine = new Set(s.records.filter((r) => r.mine).map((r) => r.id));
  return (
    <Card tone="ink" className={className} {...rest}>
      <Meta>
        <span>Audit trail</span>
        <span>Written on-chain</span>
      </Meta>
      <div className="row">
        <Headline size="m" className="grow">
          Who looked
        </Headline>
        <FlowerBadge size={54} bg="tomato" ring="ink" petal="ink" style={{ position: 'relative', filter: 'none' }} />
      </div>
      <TrailList entries={s.audit.filter((a) => mine.has(a.record))} empty="Nobody has opened your records. Every grant, view and emergency access will be listed here." />
    </Card>
  );
}
