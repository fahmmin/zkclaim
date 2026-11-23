import { describe, expect, it } from 'vitest';
import { buildBundle, contentHash, DIAGNOSES, type FhirBundle, type FhirResource, parse, PROCEDURES, SAMPLE_CASES, sectionsOf, stringify, toHex } from '../index.js';

const cardiac = SAMPLE_CASES.find((c) => c.id === 'cardiac')!.input;
const coding = (r: FhirResource, field: string) => (r[field] as { coding: { system: string; code: string }[] }).coding[0];

describe('catalogues', () => {
  it('pairs 8 CPT procedures with 8 ICD-10 diagnoses, and has the three demo cases', () => {
    expect(PROCEDURES).toHaveLength(8);
    expect(DIAGNOSES).toHaveLength(8);
    expect(PROCEDURES.map((p) => p.code)).toContain(15780);
    expect(SAMPLE_CASES.map((c) => c.id)).toEqual(expect.arrayContaining(['cardiac', 'cosmetic', 'knee']));
    for (const c of SAMPLE_CASES) expect(() => buildBundle(c.input)).not.toThrow();
  });
});

describe('buildBundle', () => {
  const bundle = buildBundle(cardiac);
  const resources = bundle.entry.map((e) => e.resource);
  const ofType = (t: string) => resources.filter((r) => r.resourceType === t);

  it('writes the FHIR R4 resources of one treatment', () => {
    expect(bundle).toMatchObject({ resourceType: 'Bundle', type: 'collection' });
    expect(resources.map((r) => r.resourceType)).toEqual([
      'Patient', 'Encounter', 'Condition', 'Procedure',
      'Observation', 'Observation', 'Observation',
      'MedicationRequest', 'MedicationRequest', 'MedicationRequest',
      'Claim',
    ]);
    for (const e of bundle.entry) expect(e.fullUrl).toBe(`urn:uuid:${e.resource.id}`);
  });

  it('uses the standard code systems', () => {
    expect(coding(ofType('Condition')[0], 'code')).toMatchObject({ system: 'http://hl7.org/fhir/sid/icd-10', code: 'I21.4' });
    expect(coding(ofType('Procedure')[0], 'code')).toMatchObject({ system: 'http://www.ama-assn.org/go/cpt', code: '92928' });
    expect(ofType('Observation').map((o) => coding(o, 'code'))).toEqual(
      cardiac.labs.map((l) => expect.objectContaining({ system: 'http://loinc.org', code: l.code })),
    );
    expect(coding(ofType('MedicationRequest')[0], 'medicationCodeableConcept')).toMatchObject({ code: '309362' });
    expect(ofType('Claim')[0]).toMatchObject({ use: 'claim', total: { value: 400, currency: 'NIGHT' } });
    expect(ofType('Patient')[0]).toMatchObject({ gender: 'female', birthDate: '1961-03-14', name: [{ family: 'Marsh', given: ['Elena'] }] });
  });

  it('only references resources inside the bundle', () => {
    const refs = [...stringify(bundle).matchAll(/"reference":"([^"]+)"/g)].map((m) => m[1]);
    expect(refs.length).toBeGreaterThan(10);
    const urls = new Set(bundle.entry.map((e) => e.fullUrl));
    for (const r of refs) expect(urls).toContain(r);
  });

  it('rejects input the contract could not take', () => {
    expect(() => buildBundle({ ...cardiac, procedure: { code: 0, display: 'none' } })).toThrow('procedure.code');
    expect(() => buildBundle({ ...cardiac, amount: 0n })).toThrow('amount');
    expect(() => buildBundle({ ...cardiac, patient: { ...cardiac.patient, name: ' ' } })).toThrow('patient.name');
  });
});

describe('sectionsOf', () => {
  it('splits a bundle into the four access sections', () => {
    const s = sectionsOf(buildBundle(cardiac));
    expect(s.clinical.map((r) => r.resourceType)).toEqual(['Patient', 'Encounter', 'Condition', 'Procedure']);
    expect(s.labs.map((r) => r.resourceType)).toEqual(['Observation', 'Observation', 'Observation']);
    expect(s.medications).toHaveLength(3);
    expect(s.claim.map((r) => r.resourceType)).toEqual(['Claim']);
  });

  it('refuses resources it has no section for, instead of dropping them', () => {
    const bundle = buildBundle(cardiac);
    bundle.entry.push({ fullUrl: 'urn:uuid:x', resource: { resourceType: 'Coverage', id: 'x' } });
    expect(() => sectionsOf(bundle)).toThrow('Coverage');
  });
});

describe('contentHash', () => {
  it('is SHA-256 of the canonical JSON (pinned: changing it breaks anchored records)', async () => {
    const empty: FhirBundle = { resourceType: 'Bundle', type: 'collection', entry: [] };
    expect(toHex(await contentHash(empty))).toBe(EMPTY_BUNDLE_HASH);
  });

  it('is stable across copies and key order, and changes with the content', async () => {
    const bundle = buildBundle(cardiac);
    const h = await contentHash(bundle);
    expect(h).toHaveLength(32);
    expect(await contentHash(bundle)).toEqual(h);
    expect(await contentHash(parse<FhirBundle>(stringify(bundle)))).toEqual(h);
    const reversed = JSON.parse(JSON.stringify(bundle), (_k, v) =>
      v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).reverse()) : v,
    );
    expect(await contentHash(reversed)).toEqual(h);
    const changed = structuredClone(bundle);
    changed.entry[0].resource.birthDate = '1961-03-15';
    expect(await contentHash(changed)).not.toEqual(h);
  });
});

// sha256('{"entry":[],"resourceType":"Bundle","type":"collection"}')
const EMPTY_BUNDLE_HASH = 'cbb860000dbb4906e42b0115c9584093c5b16c22ab75c26b5c362657ab87fef8';
