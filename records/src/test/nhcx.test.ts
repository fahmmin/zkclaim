import { describe, expect, it } from 'vitest';
import {
  buildBundle,
  buildNhcxClaimResponseBundle,
  cardCode,
  contentHash,
  memoryStore,
  newEncIdentity,
  type NhcxClaimResponseInput,
  putJson,
  SAMPLE_CASES,
  sealRecord,
  toBase64Url,
  toHex,
  type TreatmentInput,
} from '../index.js';

const NRCES = 'https://nrces.in/ndhm/fhir/r4/StructureDefinition/';
const cardiac = SAMPLE_CASES.find((c) => c.id === 'cardiac')!.input;

/** The docs/nhcx sample: the cardiac case with obviously fake names, ids and settlement values. */
const sample: NhcxClaimResponseInput = {
  settlement: { nullifier: '1'.repeat(64), policyCommitment: '2'.repeat(64), amount: cardiac.amount, settledAt: 1_793_874_600n }, // 2026-11-05T10:30:00Z
  claim: { ...cardiac, patient: { ...cardiac.patient, name: 'Synthetic Test Patient' }, encounter: { ...cardiac.encounter, hospital: 'Synthetic Test Hospital' } },
  amount: { value: 240_000, currency: 'INR' },
  insurer: 'Synthetic Test Insurer',
  ids: { patient: 'SYNTH-MRN-0001', hospital: 'SYNTH-HOSP-0001', insurer: 'SYNTH-INS-0001' },
};

const bundle = buildNhcxClaimResponseBundle(sample);
const of = (type: string): any[] => bundle.entry.map((e) => e.resource).filter((r) => r.resourceType === type);
const response = of('ClaimResponse')[0];

/** Fixture text: UUIDs renumbered in order of appearance, so regenerating gives the same file. */
function fixture(value: unknown): string {
  const ids = new Map<string, string>();
  const uuid = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;
  return `${JSON.stringify(value, null, 2).replace(uuid, (u) => {
    if (!ids.has(u)) ids.set(u, `00000000-0000-4000-8000-${String(ids.size + 1).padStart(12, '0')}`);
    return ids.get(u)!;
  })}\n`;
}

describe('buildNhcxClaimResponseBundle', () => {
  it('builds an NHCX ClaimResponseBundle whose references all resolve inside it', () => {
    expect(bundle).toMatchObject({ resourceType: 'Bundle', type: 'collection', timestamp: '2026-11-05T10:30:00.000Z', meta: { profile: [`${NRCES}ClaimResponseBundle`] } });
    expect(bundle.entry.map((e) => [e.resource.resourceType, (e.resource.meta as { profile: string[] }).profile])).toEqual([
      ['ClaimResponse', [`${NRCES}ClaimResponse`]],
      ['Patient', [`${NRCES}Patient`]],
      ['Organization', [`${NRCES}Organization`]],
      ['Organization', [`${NRCES}Organization`]],
      ['Coverage', [`${NRCES}Coverage`]],
    ]);
    for (const e of bundle.entry) {
      expect(e.fullUrl).toBe(`urn:uuid:${e.resource.id}`);
      expect(e.resource.text).toEqual({ status: 'generated', div: expect.stringMatching(/^<div xmlns="http:\/\/www\.w3\.org\/1999\/xhtml">.+<\/div>$/) });
    }
    const refs = [...JSON.stringify(bundle).matchAll(/"reference":"([^"]+)"/g)].map((m) => m[1]);
    expect(refs).toHaveLength(6);
    for (const r of refs) expect(bundle.entry.map((e) => e.fullUrl)).toContain(r);
    expect(of('Patient')[0]).toMatchObject({ name: [{ text: 'Synthetic Test Patient' }], gender: 'female', birthDate: '1961-03-14' });
  });

  it('pays the explicit INR amount and carries the settlement identifiers', () => {
    expect(response.identifier).toEqual([{ system: 'https://example.org/fhir/sid/claim-nullifier', value: sample.settlement.nullifier }]);
    expect(of('Coverage')[0].identifier).toEqual([{ system: 'https://example.org/fhir/sid/policy-commitment', value: sample.settlement.policyCommitment }]);
    expect(response).toMatchObject({ outcome: 'complete', created: '2026-11-05T10:30:00.000Z', payment: { date: '2026-11-05', amount: { value: 240_000, currency: 'INR' } } });
    expect(response.total.map((t: { amount: unknown }) => t.amount)).toEqual([{ value: 240_000, currency: 'INR' }, { value: 240_000, currency: 'INR' }]);
    // All five Money values are the INR amount; the base units appear only as text labelled NIGHT.
    const json = JSON.stringify(bundle);
    expect([...json.matchAll(/"currency":"([^"]*)"/g)].map((m) => m[1])).toEqual(Array(5).fill('INR'));
    expect([...json.matchAll(/"value":([\d.]+)/g)].map((m) => m[1])).toEqual(Array(5).fill('240000'));
    expect(response.processNote[0].text).toContain('400000000 NIGHT base units');
  });

  it('escapes names in its narratives', () => {
    const b = buildNhcxClaimResponseBundle({ ...sample, insurer: 'A & B <Mutual>' });
    const insurer = b.entry.map((e) => e.resource).find((r) => r.name === 'A & B <Mutual>')!;
    expect((insurer.text as { div: string }).div).toContain('A &amp; B &lt;Mutual&gt;, insurance company');
  });

  it('copies only what it needs: secrets and clinical details riding along on the input stay out', async () => {
    const random = () => crypto.getRandomValues(new Uint8Array(32));
    const fhir = buildBundle(sample.claim);
    const [owner, hospital, emergency] = await Promise.all([newEncIdentity(), newEncIdentity(), newEncIdentity()]);
    const claimData = { record: { patientPk: random(), hospitalPk: random(), procedureCode: 92928n, amount: cardiac.amount, contentHash: await contentHash(fhir) }, salt: random() };
    const { sealed, sectionKeys } = await sealRecord(fhir, claimData, { owner: owner.publicKey, hospital: hospital.publicKey, emergency: emergency.publicKey });
    const cid = await putJson(memoryStore(), sealed);
    const card = {
      terms: { holderPk: claimData.record.patientPk, limit: 10n ** 12n, expiresAt: 1_830_000_000n, covered: [92928n, 0n, 0n, 0n, 0n, 0n, 0n, 0n] },
      salt: random(),
      holderName: 'Synthetic Test Patient',
      insurer: sample.insurer,
      plan: 'Synthetic Plan',
      issuedAt: 1_793_000_000_000,
      policyId: sample.settlement.policyCommitment,
    };
    const code = cardCode(card);
    const riders = { claimData, sectionKeys, sealed, cid, card, code, hospitalKey: hospital.privateKey };
    const json = JSON.stringify(buildNhcxClaimResponseBundle({ ...sample, claim: { ...sample.claim, ...riders } as TreatmentInput }));

    const bytes = [claimData.salt, card.salt, claimData.record.patientPk, claimData.record.hospitalPk, claimData.record.contentHash, hospital.privateKey];
    const secrets = [...bytes.flatMap((b) => [toHex(b), toBase64Url(b)]), ...Object.values(sectionKeys), ...Object.values(sealed.keys), cid, code];
    expect(secrets).toHaveLength(22);
    for (const secret of secrets) expect(json).not.toContain(secret);
    const c = sample.claim;
    const clinical = [c.diagnosis.code, c.diagnosis.display, String(c.procedure.code), c.procedure.display, ...c.medications.map((m) => m.code), ...c.labs.map((l) => l.code)];
    for (const detail of clinical) expect(json).not.toContain(`"${detail}"`);
  });

  it('refuses NIGHT as a currency and a settlement for another claim', () => {
    const build = (change: Partial<NhcxClaimResponseInput>) => () => buildNhcxClaimResponseBundle({ ...sample, ...change });
    expect(build({ amount: { value: 400, currency: 'NIGHT' as 'INR' } })).toThrow('amount.currency must be INR');
    expect(build({ amount: { value: 0.001, currency: 'INR' } })).toThrow('amount.value');
    expect(build({ settlement: { ...sample.settlement, amount: 1n } })).toThrow('another claim');
    expect(build({ settlement: { ...sample.settlement, nullifier: '0x1234' } })).toThrow('nullifier');
    expect(build({ ids: { ...sample.ids, patient: ' ' } })).toThrow('ids');
  });

  it('matches the fixtures in docs/nhcx (regenerate: npm run nhcx:fixtures -w records)', async () => {
    const invalid = structuredClone(bundle);
    // The mistake this export avoids: the token relabelled as a currency, as the sealed record's Claim carries it.
    (invalid.entry[0].resource.payment as { amount: unknown }).amount = { value: 400, currency: 'NIGHT' };
    await expect(fixture(bundle)).toMatchFileSnapshot('../../../docs/nhcx/claimresponse-cardiac.json');
    await expect(fixture(invalid)).toMatchFileSnapshot('../../../docs/nhcx/claimresponse-cardiac-invalid-currency.json');
  });
});
