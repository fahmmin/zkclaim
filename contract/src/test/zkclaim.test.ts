import { beforeEach, describe, expect, it } from 'vitest';
import { AuditKind, type PolicyTerms, pureCircuits, type TreatmentRecord } from '../managed/zkclaim/contract/index.js';
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
const CARD_CID = 'bafkreicardcardcardcardcardcardcardcardcardcardcardcardcar';
const DOCTOR = 1n;
const LAB = 2n;
const NO_REASON = new Uint8Array(32); // a plain view; a non-zero reason is break-glass

let insurer: Actor, hospital: Actor, otherHospital: Actor, patient: Actor, stranger: Actor, doctor: Actor, responder: Actor, sim: ClaimSimulator;
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
  doctor = actor(6);
  responder = actor(7);
  terms = { holderPk: pkOf(patient), limit: 1000n, expiresAt: BigInt(NOW + YEAR), covered: [ANGIOPLASTY, MRI, 0n, 0n, 0n, 0n, 0n, 0n] };
  sim = await ClaimSimulator.create(insurer, w);
  sim.now = NOW;
  await sim.call(insurer, 'fundPool', 5000n);
  await sim.call(insurer, 'addHospital', pkOf(hospital));
  await sim.call(insurer, 'issuePolicy', policyC(), CARD_CID);
};

const now = (ahead = 30) => BigInt(sim.now + ahead);
/** Audit entries in order: the ledger map does not iterate in key order. */
const auditLog = () => [...sim.ledger.audit].sort(([a], [b]) => (a < b ? -1 : 1)).map(([, e]) => e);

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

  it('records a settlement the insurer can list: policy, amount and time only', async () => {
    await prepareClaim();
    const nullifier = await claim(400n, hospital, now(60));
    expect(sim.ledger.claims.lookup(nullifier)).toEqual({ policy: policyC(), amount: 400n, at: now(60) });
  });

  it('delivers the virtual policy card CID with the policy', () => {
    expect(sim.ledger.policyCids.lookup(policyC())).toBe(CARD_CID);
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

describe('withdrawing consent', () => {
  it('stops an unpaid claim, and nothing is paid or spent', async () => {
    await prepareClaim();
    await sim.call(patient, 'withdrawConsent');
    await expect(claim()).rejects.toThrow('Patient has not consented to this claim');
    expect(sim.ledger.totalPaid).toBe(0n);
    expect(sim.ledger.spent.member(policyC())).toBe(false);
  });

  it("leaves the patient's other authorised claims payable", async () => {
    const withdrawn = await prepareClaim();
    await sim.call(patient, 'withdrawConsent');
    await prepareClaim(makeRecord({ procedureCode: MRI, amount: 600n }, fill(0x52)));
    await claim(600n);
    share({ terms, salt: POLICY_SALT }, withdrawn, hospital, patient);
    await expect(claim()).rejects.toThrow('Patient has not consented to this claim');
    expect(sim.ledger.totalPaid).toBe(600n);
  });

  it('cannot take back a claim that was already paid', async () => {
    await prepareClaim();
    await claim();
    await expect(sim.call(patient, 'withdrawConsent')).rejects.toThrow('Claim already settled');
    expect(sim.ledger.totalPaid).toBe(400n);
  });

  it('needs a consent to withdraw', async () => {
    share({ terms, salt: POLICY_SALT }, makeRecord(), patient);
    await expect(sim.call(patient, 'withdrawConsent')).rejects.toThrow('No consent to withdraw');
  });

  it('only the patient can withdraw, even holding the same policy and record', async () => {
    await prepareClaim();
    share({ terms, salt: POLICY_SALT }, makeRecord(), stranger);
    await expect(sim.call(stranger, 'withdrawConsent')).rejects.toThrow('Policy belongs to someone else');
    await expect(sim.call(hospital, 'withdrawConsent')).rejects.toThrow('Policy belongs to someone else');
    await claim();
    expect(sim.ledger.totalPaid).toBe(400n);
  });

  it('can be given again, and the claim then pays once', async () => {
    await prepareClaim();
    await sim.call(patient, 'withdrawConsent');
    await sim.call(patient, 'consentToClaim');
    await claim();
    await expect(claim()).rejects.toThrow('Claim already settled');
    expect(sim.ledger.totalPaid).toBe(400n);
  });
});

describe('roles', () => {
  it('only the insurer can manage hospitals, policies and responders', async () => {
    await expect(sim.call(stranger, 'addHospital', pkOf(stranger))).rejects.toThrow('Only the insurer');
    await expect(sim.call(stranger, 'removeHospital', 0n)).rejects.toThrow('Only the insurer');
    await expect(sim.call(stranger, 'issuePolicy', fill(7), CARD_CID)).rejects.toThrow('Only the insurer');
    await expect(sim.call(stranger, 'setResponder', pkOf(stranger), true)).rejects.toThrow('Only the insurer');
    await expect(sim.call(stranger, 'setResponder', pkOf(stranger), false)).rejects.toThrow('Only the insurer');
  });

  it('the insurer fixes the emergency key at deploy', async () => {
    const withKey = await ClaimSimulator.create(insurer, witnesses, fill(8));
    expect(withKey.ledger.emergencyKey).toEqual(fill(8));
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

describe('records and access', () => {
  let rec: ReturnType<typeof makeRecord>;
  beforeEach(async () => {
    rec = makeRecord();
    share({ terms, salt: POLICY_SALT }, rec, hospital, patient);
    await sim.call(hospital, 'anchorRecord', recordC(rec), CID);
  });
  const grant = (to = doctor, role = DOCTOR, until = BigInt(sim.now + 3600), by = patient) =>
    sim.call(by, 'grantAccess', pkOf(to), role, until, 'section-keys-sealed-to-grantee', now());
  const view = (who = doctor) => sim.call(who, 'logView', recordC(rec), NO_REASON, now());
  const entries = () => auditLog();
  const keyFor = (who: Actor) => pureCircuits.grantKey(recordC(rec), pkOf(who));

  it('publishes encryption keys under the caller id', async () => {
    await sim.call(doctor, 'registerEncKey', fill(0xd0));
    expect(sim.ledger.encKeys.lookup(pkOf(doctor))).toEqual(fill(0xd0));
  });

  it('lets the patient grant a doctor, who must log every view', async () => {
    await grant();
    expect(sim.ledger.grants.lookup(keyFor(doctor))).toEqual({ expiresAt: BigInt(sim.now + 3600), role: DOCTOR });
    expect(sim.ledger.grantKeys.lookup(keyFor(doctor))).toBe('section-keys-sealed-to-grantee');
    await view();
    expect(entries().map((e) => e.kind)).toEqual([AuditKind.granted, AuditKind.viewed]);
    for (const e of entries()) {
      expect(e.actor).toEqual(pkOf(doctor));
      expect(e.record).toEqual(recordC(rec));
      expect(e.at).toBe(now());
    }
  });

  it('records a lab grant with its role', async () => {
    await grant(doctor, LAB);
    expect(sim.ledger.grants.lookup(keyFor(doctor)).role).toBe(LAB);
  });

  it('rejects views without a grant', async () => {
    await expect(view(stranger)).rejects.toThrow('No access grant for this record');
  });

  it('rejects views after the grant expires', async () => {
    await grant(doctor, DOCTOR, BigInt(sim.now + 600));
    sim.now += 601;
    await expect(view()).rejects.toThrow('Access grant has expired');
  });

  it('only the record owner can grant or revoke', async () => {
    share({ terms, salt: POLICY_SALT }, rec, stranger);
    await expect(grant(doctor, DOCTOR, undefined, stranger)).rejects.toThrow('Record belongs to someone else');
    await grant();
    await expect(sim.call(stranger, 'revokeAccess', pkOf(doctor), 'bafy-new', now())).rejects.toThrow('Record belongs to someone else');
  });

  it('rejects grants on unanchored records, emergency roles and past expiry', async () => {
    patient.privateState = { ...patient.privateState, record: makeRecord({}, fill(0x77)) };
    await expect(grant()).rejects.toThrow('Record was never anchored');
    patient.privateState = { ...patient.privateState, record: rec };
    await expect(grant(doctor, 4n)).rejects.toThrow('Unknown access role');
    await expect(grant(doctor, DOCTOR, BigInt(sim.now))).rejects.toThrow('Grant must expire in the future');
  });

  it('revoking removes the grant, re-points the record and blocks the next view', async () => {
    await grant();
    await sim.call(patient, 'revokeAccess', pkOf(doctor), 'bafy-reencrypted', now());
    expect(sim.ledger.recordCids.lookup(recordC(rec))).toBe('bafy-reencrypted');
    expect(sim.ledger.grantKeys.member(keyFor(doctor))).toBe(false);
    await expect(view()).rejects.toThrow('No access grant for this record');
    await expect(sim.call(patient, 'revokeAccess', pkOf(doctor), 'x', now())).rejects.toThrow('No access grant for this record');
    expect(entries().map((e) => e.kind)).toEqual([AuditKind.granted, AuditKind.revoked]);
  });

  it('rejects a clock that is behind the chain or far ahead of it', async () => {
    await grant();
    await expect(sim.call(doctor, 'logView', recordC(rec), NO_REASON, BigInt(sim.now - 1))).rejects.toThrow('Time is not current');
    await expect(sim.call(doctor, 'logView', recordC(rec), NO_REASON, BigInt(sim.now + 3600))).rejects.toThrow('Time is not current');
    await expect(claim(400n, hospital, BigInt(sim.now + 3600))).rejects.toThrow('Time is not current');
  });
});

describe('break-glass', () => {
  const REASON = fill(0xe7);
  let rec: ReturnType<typeof makeRecord>;
  beforeEach(async () => {
    rec = makeRecord();
    share({ terms, salt: POLICY_SALT }, rec, hospital);
    await sim.call(hospital, 'anchorRecord', recordC(rec), CID);
    await sim.call(insurer, 'setResponder', pkOf(responder), true);
  });
  const breakGlass = (who = responder, record = recordC(rec)) => sim.call(who, 'logView', record, REASON, now());

  it('gives an approved responder one hour of loudly logged access', async () => {
    await breakGlass();
    expect(sim.ledger.grants.lookup(pureCircuits.grantKey(recordC(rec), pkOf(responder)))).toEqual({ expiresAt: now() + 3600n, role: 4n });
    await sim.call(responder, 'logView', recordC(rec), NO_REASON, now());
    const [glass, viewed] = auditLog();
    expect(glass.kind).toBe(AuditKind.breakGlass);
    expect(glass.detail).toEqual(REASON);
    expect(viewed.kind).toBe(AuditKind.viewed);
    sim.now += 3601;
    await expect(sim.call(responder, 'logView', recordC(rec), NO_REASON, now())).rejects.toThrow('Access grant has expired');
  });

  it('refuses anyone who is not, or no longer, an approved responder', async () => {
    await expect(breakGlass(stranger)).rejects.toThrow('Not an approved emergency responder');
    await sim.call(insurer, 'setResponder', pkOf(responder), false);
    await expect(breakGlass()).rejects.toThrow('Not an approved emergency responder');
  });

  it('refuses records that were never anchored', async () => {
    await expect(breakGlass(responder, fill(0x99))).rejects.toThrow('Record was never anchored');
  });
});

describe('privacy', () => {
  it('public state never contains the record, policy terms, salts or patient identity', async () => {
    const rec = await prepareClaim();
    await claim();
    await sim.call(patient, 'grantAccess', pkOf(doctor), DOCTOR, BigInt(sim.now + 3600), 'sealed', now());
    await sim.call(doctor, 'logView', recordC(rec), NO_REASON, now());
    await sim.call(patient, 'revokeAccess', pkOf(doctor), 'bafy-reencrypted', now());
    const l = sim.ledger;
    const pairs = <K, V>(m: Iterable<[K, V]>) => [...m].flatMap(([k, v]) => [k, v]);
    const pub = [
      l.insurer, l.emergencyKey, ...l.policies, ...l.consents, ...l.responders,
      ...pairs(l.claims), ...pairs(l.spent), ...pairs(l.recordCids), ...pairs(l.policyCids),
      ...pairs(l.encKeys), ...pairs(l.grants), ...pairs(l.grantKeys), ...pairs(l.audit),
      l.hospitals.root(), l.records.root(), l.totalPaid,
    ];
    const dump = (sim.publicStateText() + JSON.stringify(pub, (_, v) => (v instanceof Uint8Array ? hex(v) : typeof v === 'bigint' ? v.toString(16) : v))).toLowerCase();
    expect(dump).toContain(hex(pkOf(insurer))); // control: the scan does see public values
    for (const secret of [pkOf(patient), rec.salt, POLICY_SALT, rec.record.contentHash, patient.privateState.secretKey, hospital.privateState.secretKey]) {
      expect(dump).not.toContain(hex(secret));
    }
  });
});
