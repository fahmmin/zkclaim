import { useEffect, useRef, useState } from 'react';
import { Asterisk, Daisy, Pixel } from '../art';
import { attempt, Card, Data, Headline, Meta, Stamp, toast } from '../ds';
import { DIAGNOSES, SAMPLE_CASES } from '@zkclaim/records';
import { type Admission, type Claim, date, fingerprint, type MedicalRecord, night, parseNight, procedureName, PROCEDURES, short, time, type TreatmentInput } from '../service';
import { useService, useSnap } from '../ctx';
import { GetReceipt } from '../receipt';
import { StatusChip } from './Patient';

/** What the claim proof attests to, in circuit order, with the contract messages that fail each one. */
const CHECKS: { label: string; fails: string[]; why?: string }[] = [
  { label: 'Approved hospital', fails: ['Hospital is not on the approved list', 'Hospital path is for a different key'] },
  { label: 'Policy issued', fails: ['Unknown policy'] },
  { label: 'Policy active', fails: ['Policy has expired', 'Claim date is in the past', 'Time is not current'] },
  { label: 'Record anchored', fails: ['Record was never anchored', 'Record path is for a different record', 'Record was issued by another hospital', 'Record is not for this policy holder'] },
  { label: 'Procedure covered', fails: ['Procedure is not covered by this policy', 'Missing procedure code'] },
  { label: 'Within limit', fails: ['Amount does not match the treatment record', 'Claim exceeds the policy limit'] },
  { label: 'Patient consent', fails: ['Patient has not consented to this claim'], why: 'The patient withdrew or never gave permission for this bill.' },
  { label: 'Never claimed', fails: ['Claim already settled'] },
];

const lines = (text: string) => text.split('\n').map((l) => l.trim()).filter(Boolean);

type Proof = { phase: 'idle' | 'proving' | 'revealing' | 'done'; shown: number; failAt: number | null; message: string; claim: Claim | null };
const IDLE: Proof = { phase: 'idle', shown: 0, failAt: null, message: '', claim: null };

export default function Hospital() {
  const s = useSnap();
  const svc = useService();
  const desk = s.hospitals.find((h) => h.id === s.desk);
  const [admission, setAdmission] = useState<Admission | null>(null);
  const [recordId, setRecordId] = useState<string | null>(null);
  const ours = s.records.filter((r) => r.hospitalId === s.desk);
  const record = ours.find((r) => r.id === recordId) ?? ours.find((r) => r.status !== 'paid') ?? ours[0] ?? null;

  return (
    <>
      <div className="deskbar">
        <label className="row">
          <span>Desk</span>
          <select value={s.desk} onChange={(e) => (svc.setDesk(e.target.value), setRecordId(null))} aria-label="Which hospital this desk is">
            {s.hospitals.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name}
              </option>
            ))}
          </select>
        </label>
        {desk && (desk.approved ? <span className="chip ok">On the approved list</span> : <span className="chip red">Not on the approved list</span>)}
      </div>
      <div className="bento">
        <Admit admission={admission} onAdmit={setAdmission} />
        <Treat admission={admission} onAnchored={setRecordId} />
        <Prove record={record} records={ours} onPick={setRecordId} />
        <History />
      </div>
    </>
  );
}

function Admit({ admission, onAdmit }: { admission: Admission | null; onAdmit: (a: Admission | null) => void }) {
  const s = useSnap();
  const svc = useService();
  const [code, setCode] = useState('');
  const admit = (c: string) => attempt(() => svc.admit(c)).then((a) => a && onAdmit(a));
  return (
    <Card tone="paper" className="s4">
      <Meta>
        <span>Step 1</span>
        <span>Admission</span>
      </Meta>
      <Headline size="m">Admit a patient</Headline>
      {s.card && (
        <button className="btn" disabled={!!s.busy} onClick={() => (setCode(s.card!.code), admit(s.card!.code))}>
          Scan {s.card.holderName.split(' ')[0]}'s phone
        </button>
      )}
      <form
        className="stack"
        style={{ gap: 10 }}
        onSubmit={(e) => {
          e.preventDefault();
          void admit(code);
        }}
      >
        <label className="field">
          <span>Or paste the card code</span>
          <textarea value={code} onChange={(e) => setCode(e.target.value)} placeholder="ZKC1.…" rows={3} spellCheck={false} />
        </label>
        <button className="btn ghost" disabled={!code.trim() || !!s.busy}>
          Admit
        </button>
      </form>
      {admission && (
        <div className="admitted">
          <div className="hl s">{admission.card.holderName}</div>
          <div className="small">
            {admission.card.plan}, card <Data>{fingerprint(admission.card.fingerprint)}</Data>
          </div>
          <ul className="ticks">
            <li data-ok={admission.onChain}>{admission.onChain ? 'Policy is on-chain' : 'Policy not found on-chain'}</li>
            <li data-ok={!admission.expired}>{admission.expired ? `Expired ${date(admission.card.expiresAt)}` : `Active till ${date(admission.card.expiresAt)}`}</li>
            <li data-ok={admission.spent < admission.card.limit}>
              {night(admission.card.limit - admission.spent)} of {night(admission.card.limit)} left
            </li>
          </ul>
        </div>
      )}
    </Card>
  );
}

function Treat({ admission, onAnchored }: { admission: Admission | null; onAnchored: (id: string) => void }) {
  const s = useSnap();
  const svc = useService();
  const [caseId, setCaseId] = useState(SAMPLE_CASES[0].id);
  const base = SAMPLE_CASES.find((c) => c.id === caseId)!.input;
  const [dx, setDx] = useState(base.diagnosis.code);
  const [px, setPx] = useState(base.procedure.code);
  const [amount, setAmount] = useState(night(base.amount, false));
  const [sex, setSex] = useState(base.patient.gender);
  const [born, setBorn] = useState(base.patient.birthDate);
  const [done, setDone] = useState<MedicalRecord | null>(null);
  const units = parseNight(amount);
  const desk = s.hospitals.find((h) => h.id === s.desk);
  const covered = admission?.card.covered.includes(px);
  const pick = (id: string) => {
    const b = SAMPLE_CASES.find((c) => c.id === id)!.input;
    setCaseId(id);
    setDx(b.diagnosis.code);
    setPx(b.procedure.code);
    setAmount(night(b.amount, false));
    setSex(b.patient.gender);
    setBorn(b.patient.birthDate);
    setDone(null);
  };

  const submit = async () => {
    if (!admission || !units || !desk) return;
    const input: TreatmentInput = {
      ...base,
      patient: { name: admission.card.holderName, gender: sex, birthDate: born },
      encounter: { start: new Date(s.now * 1000).toISOString(), hospital: desk.name },
      diagnosis: DIAGNOSES.find((d) => d.code === dx)!,
      procedure: { code: px, display: procedureName(px) },
      amount: units,
    };
    const r = await attempt(() => svc.createRecord(admission.card, input));
    if (r) {
      setDone(r);
      onAnchored(r.id);
      toast(`Record sealed to ${admission.card.holderName} and anchored`);
    }
  };

  return (
    <Card tone="teal" className="s8">
      <Meta>
        <span>Step 2</span>
        <span>{admission ? `Treating ${admission.card.holderName}` : 'Admit someone first'}</span>
      </Meta>
      <div className="row">
        <Headline size="m" className="grow">
          Treat &amp; seal the record
        </Headline>
        <Pixel art="floppy" scale={4} />
      </div>
      <div className="chips" role="group" aria-label="Sample cases">
        {SAMPLE_CASES.map((c) => (
          <button key={c.id} type="button" className="chip" aria-pressed={caseId === c.id} onClick={() => pick(c.id)}>
            {c.title}
          </button>
        ))}
      </div>
      <div className="grid2">
        <div className="field">
          <span>Sex</span>
          <div className="chips" role="group" aria-label="Sex">
            {(['female', 'male', 'other'] as const).map((g) => (
              <button key={g} type="button" className="chip" aria-pressed={sex === g} onClick={() => setSex(g)}>
                {g[0].toUpperCase() + g.slice(1)}
              </button>
            ))}
          </div>
        </div>
        <label className="field">
          <span>Born</span>
          <input type="date" value={born} onChange={(e) => setBorn(e.target.value)} />
        </label>
        <label className="field">
          <span>Diagnosis (ICD-10)</span>
          <select value={dx} onChange={(e) => setDx(e.target.value)}>
            {DIAGNOSES.map((d) => (
              <option key={d.code} value={d.code}>
                {d.code} {d.display}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Procedure (CPT) {admission && (covered ? 'covered by the card' : 'not on the card')}</span>
          <select value={px} onChange={(e) => setPx(Number(e.target.value))}>
            {PROCEDURES.map((p) => (
              <option key={p.code} value={p.code}>
                {p.code} {p.name}
              </option>
            ))}
          </select>
        </label>
        <div className="field">
          <span>Medications</span>
          <ul className="plain small">
            {base.medications.map((m) => (
              <li key={m.code}>{m.display}</li>
            ))}
            {base.medications.length === 0 && <li>None</li>}
          </ul>
        </div>
        <div className="field">
          <span>Lab results</span>
          <ul className="plain small">
            {base.labs.map((l) => (
              <li key={l.code}>
                {l.display}: {l.value} {l.unit}
              </li>
            ))}
            {base.labs.length === 0 && <li>None</li>}
          </ul>
        </div>
        <label className="field">
          <span>Bill in NIGHT</span>
          <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} aria-invalid={!units} />
        </label>
      </div>
      <div className="row">
        <button className="btn big" disabled={!admission || !units || !!s.busy} onClick={submit}>
          Seal, upload &amp; anchor
        </button>
        <p className="small grow">A FHIR record, encrypted section by section for the patient before it leaves this desk. Only a commitment goes on-chain.</p>
      </div>
      {done && (
        <ul className="ticks">
          <li data-ok>Sealed to {done.patientName}, this hospital and the emergency key</li>
          <li data-ok>
            Stored on IPFS as <Data>{short(done.cid, 10, 6)}</Data>
          </li>
          <li data-ok>
            Anchored on-chain as <Data>{short(done.id, 8, 6)}</Data>
          </li>
        </ul>
      )}
    </Card>
  );
}

function Prove({ record, records, onPick }: { record: MedicalRecord | null; records: MedicalRecord[]; onPick: (id: string) => void }) {
  const s = useSnap();
  const svc = useService();
  const [proof, setProof] = useState<Proof>(IDLE);
  const live = useRef(true);
  useEffect(() => {
    live.current = true; // StrictMode mounts twice; reset after the simulated unmount
    return () => {
      live.current = false;
    };
  }, []);
  useEffect(() => setProof(IDLE), [record?.id]);
  const desk = s.hospitals.find((h) => h.id === s.desk);

  const run = async () => {
    if (!record) return;
    onPick(record.id); // stay on this bill: once it is paid, the default would jump to the next unpaid one mid-result
    setProof({ ...IDLE, phase: 'proving' });
    let claim: Claim | null = null;
    let message = '';
    try {
      claim = await svc.submitClaim(record.id);
    } catch (e) {
      message = e instanceof Error ? e.message : String(e);
    }
    // -1: not one of the contract's refusals (the wallet, the network): no check gets the blame.
    const failAt = claim ? null : CHECKS.findIndex((c) => c.fails.some((f) => message.includes(f)));
    const last = failAt ?? CHECKS.length;
    for (let i = 1; i <= Math.min(last + 1, CHECKS.length); i++) {
      if (!live.current) return;
      setProof({ phase: 'revealing', shown: i, failAt, message, claim });
      await new Promise((r) => setTimeout(r, 230));
    }
    if (live.current) setProof({ phase: 'done', shown: CHECKS.length, failAt, message, claim });
  };

  const state = (i: number) => (i >= proof.shown ? 'wait' : proof.failAt === i ? 'bad' : proof.failAt !== null && i > proof.failAt ? 'wait' : 'ok');

  return (
    <Card tone="ink" className="s8 prove">
      <Meta>
        <span>Step 3</span>
        <span>Claim</span>
      </Meta>
      <div className="row">
        <Headline size="l" className="grow">
          Prove &amp; get paid
        </Headline>
        <Pixel art="computer" scale={5} />
      </div>
      {!record ? (
        <p className="lede">Anchor a treatment record first. Then the patient consents on their phone, and this desk proves the claim.</p>
      ) : (
        <>
          <div className="row">
            {records.length > 1 ? (
              <select value={record.id} onChange={(e) => onPick(e.target.value)} aria-label="Record to claim" style={{ maxWidth: 360 }}>
                {records.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.patientName}: {r.procedure.name}, {night(r.amount)}
                  </option>
                ))}
              </select>
            ) : (
              <b className="grow">
                {record.patientName}: {record.procedure.name}, {night(record.amount)}
              </b>
            )}
            <StatusChip r={record} />
          </div>
          {record.status === 'anchored' && (
            <p className="small">No permission from {record.patientName.split(' ')[0]} for this bill: not given yet, or withdrawn. You can try now, but the contract will refuse it.</p>
          )}
          <button className="btn big light" disabled={!!s.busy || proof.phase === 'proving' || proof.phase === 'revealing'} onClick={run}>
            {proof.phase === 'proving' ? 'Proving…' : 'Prove & submit claim'}
          </button>
          {proof.phase === 'proving' && (
            <div className="progress" aria-label="Building the proof">
              <i style={{ width: '70%' }} />
            </div>
          )}
          {proof.phase !== 'idle' && proof.phase !== 'proving' && (
            <ol className="checks" aria-live="polite">
              {CHECKS.map((c, i) => (
                <li key={c.label} data-state={state(i)}>
                  <span className="tick" aria-hidden="true">
                    {state(i) === 'ok' ? '✓' : state(i) === 'bad' ? '✗' : ''}
                  </span>
                  {c.label}
                </li>
              ))}
            </ol>
          )}
          {proof.phase === 'done' && proof.claim && (
            <div className="payout">
              <Stamp slam size={92} rot={-10} tone="leaf" sub={`${night(proof.claim.amount)}`}>
                Paid
              </Stamp>
              <p className="lede">
                {night(proof.claim.amount)} sent from the pool to {desk?.name}'s wallet. Nullifier <Data>{short(proof.claim.nullifier, 8, 4)}</Data> is spent, so this record can never be claimed again.
              </p>
              <Daisy face="happy" size={84} style={{ position: 'relative' }} />
            </div>
          )}
          {proof.phase === 'done' && proof.claim && <GetReceipt claim={proof.claim} />}
          {proof.phase === 'done' && !proof.claim && (
            <div className="payout shake">
              <Stamp slam size={64} rot={-8} tone="red" sub={proof.failAt === -1 ? 'not settled' : 'by the contract'}>
                {proof.failAt === -1 ? 'Failed' : 'Rejected'}
              </Stamp>
              <p className="err grow">
                {proof.message}
                {proof.failAt !== null && CHECKS[proof.failAt]?.why && (
                  <>
                    <br />
                    <span className="small">{CHECKS[proof.failAt]?.why}</span>
                  </>
                )}
              </p>
            </div>
          )}
        </>
      )}
    </Card>
  );
}

function History() {
  const s = useSnap();
  const ours = s.claims.filter((c) => c.hospitalId === s.desk);
  const total = ours.reduce((a, c) => a + c.amount, 0n);
  return (
    <Card tone="mustard" className="s4">
      <Meta>
        <span>Paid to us</span>
        <span>{night(total)}</span>
      </Meta>
      <div className="row">
        <Headline size="m" className="grow">
          History
        </Headline>
        <Asterisk size={34} />
      </div>
      {ours.length === 0 ? (
        <p className="small">No claims paid to this hospital yet.</p>
      ) : (
        <ul className="list">
          {ours.map((c) => {
            const r = s.records.find((x) => x.id === c.recordId);
            return (
              <li key={c.nullifier}>
                <div className="grow">
                  <b>{r ? `${r.patientName}: ${procedureName(r.procedure.code)}` : 'Claim'}</b>
                  <div className="small">
                    {night(c.amount)} at {time(c.at)}
                  </div>
                </div>
                <Data title={c.nullifier}>{short(c.nullifier, 4, 4)}</Data>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
