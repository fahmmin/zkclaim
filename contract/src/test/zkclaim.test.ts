import { beforeEach, describe, expect, it } from 'vitest';
import { type PolicyTerms, pureCircuits, type TreatmentRecord } from '../managed/zkclaim/contract/index.js';
import { type Actor, actor, ClaimSimulator, pkOf } from '../simulator.js';
import { witnesses } from '../witnesses.js';

const fill = (n: number) => new Uint8Array(32).fill(n);
const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');

const NOW = 1_800_000_000;
const YEAR = 365 * 86_400;
const ANGIOPLASTY = 101n;
const MRI = 202n;
const COSMETIC = 303n;
const PAY_TO = { bytes: fill(0xee) };
const CID = 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi';

let insurer: Actor, hospital: Actor, otherHospital: Actor, patient: Actor, stranger: Actor, sim: ClaimSimulator;
let terms: PolicyTerms;
const POLICY_SALT = fill(0x50);

const policyC = (t = terms, salt = POLICY_SALT) => pureCircuits.policyCommitment(t, salt);
const recordC = (r: { record: TreatmentRecord; salt: Uint8Array }) => pureCircuits.recordCommitment(r.record, r.salt);

const makeRecord = (over: Partial<TreatmentRecord> = {}, salt = fill(0x51)) => ({
  record: {
    patientPk: pkOf(patient),
    hospitalPk: pkOf(hospital),
    procedureCode: ANGIOPLASTY,
    amount: 400n,
    contentHash: fill(0xcc),
    ...over,
  },
  salt,
});

/** The patient shows the hospital their policy card and gets the record; both now hold both. */
const share = (policy: Actor['privateState']['policy'], record: Actor['privateState']['record'], ...who: Actor[]) => {
  for (const a of who) a.privateState = { ...a.privateState, policy, record };
};

/** Hospital anchors `rec`, patient consents, both hold the claim data. */
const prepareClaim = async (rec = makeRecord(), by = hospital) => {
  share({ terms, salt: POLICY_SALT }, rec, by, patient);
  await sim.call(by, 'anchorRecord', recordC(rec), CID);
  await sim.call(patient, 'consentToClaim');
  return rec;
};

const claim = (amount = 400n, by = hospital, asOf = BigInt(sim.now + 60)) => sim.call(by, 'submitClaim', amount, asOf, PAY_TO);

const setup = async (w = witnesses) => {
  insurer = actor(1);
  hospital = actor(2);
  otherHospital = actor(3);
  patient = actor(4);
  stranger = actor(5);
  terms = { holderPk: pkOf(patient), limit: 1000n, expiresAt: BigInt(NOW + YEAR), covered: [ANGIOPLASTY, MRI, 0n, 0n, 0n, 0n, 0n, 0n] };
  sim = await ClaimSimulator.create(insurer, w);
  sim.now = NOW;
  await sim.call(insurer, 'fundPool', 5000n);
  await sim.call(insurer, 'addHospital', pkOf(hospital));
  await sim.call(insurer, 'issuePolicy', policyC());
};

beforeEach(() => setup());

describe('happy path', () => {
  it('settles a valid claim and pays the hospital automatically', async () => {
    const rec = await prepareClaim();
    const nullifier = await claim();
    expect(sim.lastTransfers.paid).toBe(400n);
    expect(nullifier).toEqual(pureCircuits.claimNullifier(recordC(rec), rec.salt));
    expect(sim.ledger.claims.member(nullifier)).toBe(true);
    expect(sim.ledger.totalPaid).toBe(400n);
    expect(sim.ledger.spent.lookup(policyC())).toBe(400n);
  });

  it('fundPool pulls tokens into the contract', async () => {
    await sim.call(insurer, 'fundPool', 250n);
    expect(sim.lastTransfers.received).toBe(250n);
  });

  it('stores the encrypted record CID on-chain', async () => {
    const rec = await prepareClaim();
    expect(sim.ledger.recordCids.lookup(recordC(rec))).toBe(CID);
  });

  it('lets two records under one policy be claimed up to the limit', async () => {
    await prepareClaim();
    await claim();
    await prepareClaim(makeRecord({ procedureCode: MRI, amount: 600n }, fill(0x52)));
    await claim(600n);
    expect(sim.ledger.spent.lookup(policyC())).toBe(1000n);
  });
});

describe('claim proof rejects', () => {
  it('a hospital that is not on the approved list', async () => {
    share({ terms, salt: POLICY_SALT }, makeRecord({ hospitalPk: pkOf(otherHospital) }), otherHospital);
    await expect(sim.call(otherHospital, 'anchorRecord', fill(9), CID)).rejects.toThrow('Hospital is not on the approved list');
    await expect(claim(400n, otherHospital)).rejects.toThrow('Hospital is not on the approved list');
  });

  it('a hospital the insurer removed from the list', async () => {
    await prepareClaim();
    await sim.call(insurer, 'removeHospital', 0n);
    await expect(claim()).rejects.toThrow('Hospital is not on the approved list');
  });

  it('a forged membership path borrowed from an approved hospital', async () => {
    await setup({ ...witnesses, hospitalPath: ({ privateState, ledger }) => [privateState, ledger.hospitals.findPathForLeaf(pkOf(hospital))!] });
    await expect(sim.call(stranger, 'anchorRecord', fill(9), CID)).rejects.toThrow('Hospital path is for a different key');
  });

  it('a policy the insurer never issued', async () => {
    await prepareClaim();
    hospital.privateState = { ...hospital.privateState, policy: { terms: { ...terms, limit: 1_000_000n }, salt: POLICY_SALT } };
    await expect(claim()).rejects.toThrow('Unknown policy');
  });

  it('an expired policy', async () => {
    await prepareClaim();
    sim.now = NOW + YEAR;
    await expect(claim()).rejects.toThrow('Policy has expired');
  });

  it('a claim date in the past', async () => {
    await prepareClaim();
    await expect(claim(400n, hospital, BigInt(NOW - 10))).rejects.toThrow('Claim date is in the past');
  });

  it('a procedure outside the covered set', async () => {
    await prepareClaim(makeRecord({ procedureCode: COSMETIC }));
    await expect(claim()).rejects.toThrow('Procedure is not covered by this policy');
  });

  it('procedure code 0, which pads the covered set', async () => {
    await prepareClaim(makeRecord({ procedureCode: 0n }));
    await expect(claim()).rejects.toThrow('Missing procedure code');
  });

  it('an amount that differs from the treatment record', async () => {
    await prepareClaim();
    await expect(claim(500n)).rejects.toThrow('Amount does not match the treatment record');
  });

  it('a single claim over the policy limit', async () => {
    await prepareClaim(makeRecord({ amount: 1200n }));
    await expect(claim(1200n)).rejects.toThrow('Claim exceeds the policy limit');
  });

  it('claims that together exceed the policy limit', async () => {
    await prepareClaim(makeRecord({ amount: 700n }));
    await claim(700n);
    await prepareClaim(makeRecord({ amount: 400n }, fill(0x52)));
    await expect(claim(400n)).rejects.toThrow('Claim exceeds the policy limit');
  });

  it('a record that was never anchored on-chain', async () => {
    share({ terms, salt: POLICY_SALT }, makeRecord(), hospital, patient);
    await sim.call(patient, 'consentToClaim');
    await expect(claim()).rejects.toThrow('Record was never anchored');
  });

  it('a record issued by a different approved hospital', async () => {
    await sim.call(insurer, 'addHospital', pkOf(otherHospital));
    const rec = await prepareClaim(makeRecord({ hospitalPk: pkOf(otherHospital) }), otherHospital);
    share({ terms, salt: POLICY_SALT }, rec, hospital);
    await expect(claim()).rejects.toThrow('Record was issued by another hospital');
  });

  it('a record for someone other than the policy holder', async () => {
    await prepareClaim(makeRecord({ patientPk: pkOf(stranger) })).catch(() => undefined);
    await expect(claim()).rejects.toThrow('Record is not for this policy holder');
  });

  it('a claim the patient did not consent to', async () => {
    const rec = makeRecord();
    share({ terms, salt: POLICY_SALT }, rec, hospital);
    await sim.call(hospital, 'anchorRecord', recordC(rec), CID);
    await expect(claim()).rejects.toThrow('Patient has not consented to this claim');
  });

  it('a replay of a settled claim', async () => {
    await prepareClaim();
    await claim();
    await expect(claim()).rejects.toThrow('Claim already settled');
    expect(sim.ledger.totalPaid).toBe(400n);
  });
});

describe('roles', () => {
  it('only the insurer can manage hospitals and policies', async () => {
    await expect(sim.call(stranger, 'addHospital', pkOf(stranger))).rejects.toThrow('Only the insurer');
    await expect(sim.call(stranger, 'removeHospital', 0n)).rejects.toThrow('Only the insurer');
    await expect(sim.call(stranger, 'issuePolicy', fill(7))).rejects.toThrow('Only the insurer');
  });

  it('only the patient can consent', async () => {
    share({ terms, salt: POLICY_SALT }, makeRecord(), stranger);
    await expect(sim.call(stranger, 'consentToClaim')).rejects.toThrow('Policy belongs to someone else');
  });

  it('the same record cannot be anchored twice', async () => {
    const rec = await prepareClaim();
    await expect(sim.call(hospital, 'anchorRecord', recordC(rec), CID)).rejects.toThrow('Record already anchored');
  });
});

describe('privacy', () => {
  it('public state never contains the record, policy terms, salts or patient identity', async () => {
    const rec = await prepareClaim();
    await claim();
    const l = sim.ledger;
    const pub = [
      l.insurer, ...l.policies, ...l.consents, ...l.claims,
      ...[...l.spent].flatMap(([k, v]) => [k, v]), ...[...l.recordCids].flatMap(([k, v]) => [k, v]),
      l.hospitals.root(), l.records.root(), l.totalPaid,
    ];
    const dump = (sim.publicStateText() + JSON.stringify(pub, (_, v) => (v instanceof Uint8Array ? hex(v) : typeof v === 'bigint' ? v.toString(16) : v))).toLowerCase();
    expect(dump).toContain(hex(pkOf(insurer))); // control: the scan does see public values
    for (const secret of [pkOf(patient), rec.salt, POLICY_SALT, rec.record.contentHash, patient.privateState.secretKey, hospital.privateState.secretKey]) {
      expect(dump).not.toContain(hex(secret));
    }
  });
});
