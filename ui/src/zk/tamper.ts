// Tamper Lab: each attack runs against its own fresh in-browser simulator (the compiled contract's real circuit
// logic), so what the screen shows is the contract's own rejection, not ours.
import { type Actor, actions, actor, ClaimSimulator, NO_REASON, pkOf, type PolicyTerms, pureCircuits, type TreatmentRecord, witnesses } from '@zkclaim/contract';
import { reason } from './service';

const NIGHT = 1_000_000n;
const YEAR = 365 * 86_400;
const ANGIOPLASTY = 101n;
const MRI = 202n;
const COSMETIC = 303n;
const AMOUNT = 1_850n * NIGHT;
const CID = 'bafkreitamperlabrecord';
const CARD_CID = 'bafkreitamperlabcard';
const PAY_TO = { bytes: new Uint8Array(32).fill(0xee) };
const fill = (n: number) => new Uint8Array(32).fill(n);

/** Runs a named contract action (`actions` maps it onto the shared circuit) as `who`. */
const act = (sim: ClaimSimulator, who: Actor, { circuitId, args }: { circuitId: string; args: unknown[] }) =>
  (sim.call as (who: Actor, id: string, ...a: unknown[]) => Promise<unknown>)(who, circuitId, ...args);

/** Insurer funded, one approved hospital, a Gold policy for the patient: the same start as the story. */
async function world(w: typeof witnesses = witnesses) {
  const insurer = actor(1);
  const hospital = actor(2);
  const unlicensed = actor(3);
  const patient = actor(4);
  const doctor = actor(5);
  const pharmacy = actor(6);
  const volunteer = actor(7);
  const sim = await ClaimSimulator.create(insurer, w);
  sim.now = Math.floor(Date.now() / 1000);
  const terms: PolicyTerms = { holderPk: pkOf(patient), limit: 5_000n * NIGHT, expiresAt: BigInt(sim.now + YEAR), covered: [ANGIOPLASTY, MRI, 0n, 0n, 0n, 0n, 0n, 0n] };
  const policy = { terms, salt: fill(0x50) };
  await sim.call(insurer, 'fundPool', 50_000n * NIGHT);
  await act(sim, insurer, actions.addHospital(pkOf(hospital)));
  await act(sim, insurer, actions.issuePolicy(pureCircuits.policyCommitment(terms, policy.salt), CARD_CID));

  const record = (over: Partial<TreatmentRecord> = {}, salt = fill(0x51)) => ({
    record: { patientPk: pkOf(patient), hospitalPk: pkOf(hospital), procedureCode: ANGIOPLASTY, amount: AMOUNT, contentHash: fill(0xcc), ...over },
    salt,
  });
  type Rec = ReturnType<typeof record>;
  const hold = (rec: Rec, pol: typeof policy, ...who: Actor[]) => {
    for (const a of who) a.privateState = { ...a.privateState, policy: pol, record: rec };
  };
  /** Hospital anchors the record and (unless told not to) the patient consents. */
  const prepare = async (rec = record(), consent = true) => {
    hold(rec, policy, hospital, patient);
    await sim.call(hospital, 'anchorRecord', pureCircuits.recordCommitment(rec.record, rec.salt), CID);
    if (consent) await sim.call(patient, 'consentToClaim');
  };
  const claim = (amount = AMOUNT, by = hospital) => sim.call(by, 'submitClaim', amount, BigInt(sim.now), PAY_TO);
  const recordC = pureCircuits.recordCommitment(record().record, record().salt);
  /** The patient shares the default record with `who` for an hour (the wrapped key is opaque to the contract). */
  const grant = (who: Actor, role: bigint) => act(sim, patient, actions.grantAccess(pkOf(who), role, BigInt(sim.now + 3600), 'wrapped-keys', BigInt(sim.now)));
  const view = (who: Actor) => sim.call(who, 'logView', recordC, NO_REASON, BigInt(sim.now));
  return { sim, insurer, hospital, unlicensed, patient, doctor, pharmacy, volunteer, policy, record, hold, prepare, claim, recordC, grant, view };
}

export type Attack = {
  id: string;
  title: string;
  who: string;
  story: string;
  expect: string;
  run: () => Promise<unknown>;
};

export const ATTACKS: Attack[] = [
  {
    id: 'replay',
    title: 'Replay a paid claim',
    who: 'Hospital',
    story: 'Send the same valid proof a second time and get paid twice.',
    expect: 'Claim already settled',
    run: async () => {
      const w = await world();
      await w.prepare();
      await w.claim();
      await w.claim();
    },
  },
  {
    id: 'expired',
    title: 'Claim on an expired policy',
    who: 'Hospital',
    story: 'The card ran out yesterday. Claim anyway.',
    expect: 'Policy has expired',
    run: async () => {
      const w = await world();
      await w.prepare();
      w.sim.now += YEAR + 86_400;
      await w.claim();
    },
  },
  {
    id: 'uncovered',
    title: 'Bill an uncovered procedure',
    who: 'Hospital',
    story: 'A cosmetic nose job on a plan that covers hearts and knees.',
    expect: 'Procedure is not covered by this policy',
    run: async () => {
      const w = await world();
      await w.prepare(w.record({ procedureCode: COSMETIC }));
      await w.claim();
    },
  },
  {
    id: 'unlicensed',
    title: 'Unlicensed clinic claims',
    who: 'Quickfix Clinic',
    story: 'A clinic the insurer never approved submits a claim.',
    expect: 'Hospital is not on the approved list',
    run: async () => {
      const w = await world();
      w.hold(w.record({ hospitalPk: pkOf(w.unlicensed) }), w.policy, w.unlicensed);
      await w.claim(AMOUNT, w.unlicensed);
    },
  },
  {
    id: 'removed',
    title: 'Struck-off hospital claims',
    who: 'Hospital',
    story: 'The insurer removed this hospital. It tries a claim it prepared earlier.',
    expect: 'Hospital is not on the approved list',
    run: async () => {
      const w = await world();
      await w.prepare();
      await act(w.sim, w.insurer, actions.removeHospital(0n));
      await w.claim();
    },
  },
  {
    id: 'forged-path',
    title: 'Borrow a membership proof',
    who: 'Quickfix Clinic',
    story: "Copy an approved hospital's Merkle path and pass it off as its own.",
    expect: 'Hospital path is for a different key',
    run: async () => {
      const approved = pkOf(actor(2));
      const w = await world({ ...witnesses, hospitalPath: ({ privateState, ledger }) => [privateState, ledger.hospitals.findPathForLeaf(approved)!] });
      await w.sim.call(w.unlicensed, 'anchorRecord', fill(9), CID);
    },
  },
  {
    id: 'forged-card',
    title: 'Doctor the policy card',
    who: 'Hospital',
    story: 'Edit the card to raise the limit to a million NIGHT.',
    expect: 'Unknown policy',
    run: async () => {
      const w = await world();
      await w.prepare();
      w.hold(w.record(), { ...w.policy, terms: { ...w.policy.terms, limit: 1_000_000n * NIGHT } }, w.hospital);
      await w.claim();
    },
  },
  {
    id: 'over-limit',
    title: 'Blow through the limit',
    who: 'Hospital',
    story: 'Bill 6,000 NIGHT on a policy capped at 5,000.',
    expect: 'Claim exceeds the policy limit',
    run: async () => {
      const w = await world();
      await w.prepare(w.record({ amount: 6_000n * NIGHT }));
      await w.claim(6_000n * NIGHT);
    },
  },
  {
    id: 'mismatch',
    title: 'Pad the bill',
    who: 'Hospital',
    story: 'The record says 1,850 NIGHT. Claim 2,500.',
    expect: 'Amount does not match the treatment record',
    run: async () => {
      const w = await world();
      await w.prepare();
      await w.claim(2_500n * NIGHT);
    },
  },
  {
    id: 'no-consent',
    title: 'Skip the patient',
    who: 'Hospital',
    story: 'Claim before the patient agreed to it.',
    expect: 'Patient has not consented to this claim',
    run: async () => {
      const w = await world();
      await w.prepare(w.record(), false);
      await w.claim();
    },
  },
  {
    id: 'withdrawn',
    title: 'Claim after the patient withdrew',
    who: 'Hospital',
    story: 'The patient gave permission, then took it back before the bill was settled. Claim it anyway.',
    expect: 'Patient has not consented to this claim',
    run: async () => {
      const w = await world();
      await w.prepare();
      await act(w.sim, w.patient, actions.withdrawConsent());
      await w.claim();
    },
  },
  {
    id: 'no-grant',
    title: 'Peek without a grant',
    who: 'Doctor',
    story: "Open a patient's record that nobody shared with you.",
    expect: 'No access grant for this record',
    run: async () => {
      const w = await world();
      await w.prepare();
      await w.view(w.doctor);
    },
  },
  {
    id: 'revoked',
    title: 'Use a revoked grant',
    who: 'Pharmacy',
    story: 'The patient revoked your access. Open the record anyway.',
    expect: 'No access grant for this record',
    run: async () => {
      const w = await world();
      await w.prepare();
      await w.grant(w.pharmacy, 3n);
      await act(w.sim, w.patient, actions.revokeAccess(pkOf(w.pharmacy), 'bafkreiresealedcopy', BigInt(w.sim.now)));
      await w.view(w.pharmacy);
    },
  },
  {
    id: 'expired-grant',
    title: 'Come back after the grant ran out',
    who: 'Doctor',
    story: 'One hour of access, opened two hours later.',
    expect: 'Access grant has expired',
    run: async () => {
      const w = await world();
      await w.prepare();
      await w.grant(w.doctor, 1n);
      w.sim.now += 7200;
      await w.view(w.doctor);
    },
  },
  {
    id: 'fake-responder',
    title: 'Fake an emergency',
    who: 'Volunteer',
    story: 'Break the glass without being an approved responder.',
    expect: 'Not an approved emergency responder',
    run: async () => {
      const w = await world();
      await w.prepare();
      await w.sim.call(w.volunteer, 'logView', w.recordC, fill(7), BigInt(w.sim.now));
    },
  },
];

export type AttackResult = { ok: boolean; message: string; ms: number };

/** ok means the contract rejected the attack with the expected message. */
export async function runAttack(a: Attack): Promise<AttackResult> {
  const started = performance.now();
  try {
    await a.run();
    return { ok: false, message: 'Accepted: the contract did not stop this', ms: performance.now() - started };
  } catch (e) {
    const message = reason(e);
    return { ok: message.includes(a.expect), message, ms: performance.now() - started };
  }
}
