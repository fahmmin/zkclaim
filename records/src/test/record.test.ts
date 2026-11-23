import { describe, expect, it } from 'vitest';
import {
  buildBundle,
  type ClaimData,
  contentHash,
  type FhirBundle,
  grantKeyFor,
  newEncIdentity,
  openRecord,
  parse,
  resealRecord,
  ROLE_SECTIONS,
  SAMPLE_CASES,
  type SealedRecord,
  sealRecord,
  type SectionKeys,
  sectionKeysFor,
  sectionsOf,
  stringify,
  unwrapGrant,
} from '../index.js';

const fill = (n: number) => new Uint8Array(32).fill(n);
const [owner, hospital, emergency, doctor, lab, pharmacy, stranger] = await Promise.all(Array.from({ length: 7 }, () => newEncIdentity()));
const who = { owner, hospital, emergency, doctor, lab, pharmacy };
const recipients = { owner: owner.publicKey, hospital: hospital.publicKey, emergency: emergency.publicKey };

const bundle = buildBundle(SAMPLE_CASES[0].input);
const claimData: ClaimData = {
  record: { patientPk: fill(1), hospitalPk: fill(2), procedureCode: 92928n, amount: 400_000_000n, contentHash: await contentHash(bundle) },
  salt: fill(3),
};
const { sealed, sectionKeys } = await sealRecord(bundle, claimData, recipients);

/** Which parts a key set opens. */
const opens = async (s: SealedRecord, keys: SectionKeys) => {
  const o = await openRecord(s, keys);
  return [...Object.keys(o.sections), ...(o.claimData ? ['claimData'] : [])].sort();
};
const grantFor = async (role: 'doctor' | 'lab' | 'pharmacy' | 'emergency', keys = sectionKeys) =>
  unwrapGrant(await grantKeyFor(keys, role, who[role].publicKey), who[role]);

describe('sealRecord', () => {
  it('survives JSON storage and opens fully for the owner and the hospital', async () => {
    const stored = parse<SealedRecord>(stringify(sealed));
    for (const as of ['owner', 'hospital'] as const) {
      const opened = await openRecord(stored, await sectionKeysFor(stored, as, who[as]));
      expect(opened.claimData).toEqual(claimData);
      expect(opened.sections).toEqual(sectionsOf(bundle));
    }
  });

  it('lets a full-key holder rebuild the bundle and re-check its contentHash', async () => {
    const { sections, claimData: opened } = await openRecord(sealed, sectionKeys);
    const entry = (['clinical', 'labs', 'medications', 'claim'] as const).flatMap((s) => sections[s]!).map((resource) => ({ fullUrl: `urn:uuid:${resource.id}`, resource }));
    const rebuilt: FhirBundle = { resourceType: 'Bundle', type: 'collection', entry };
    expect(await contentHash(rebuilt)).toEqual(opened!.record.contentHash);
  });

  it('refuses claim data whose contentHash is not the bundle it seals', async () => {
    await expect(sealRecord(buildBundle(SAMPLE_CASES[0].input), claimData, recipients)).rejects.toThrow('contentHash');
    await expect(sealRecord(bundle, { ...claimData, salt: new Uint8Array(3) }, recipients)).rejects.toThrow('Invalid claim data');
    await expect(sealRecord(bundle, claimData, { ...recipients, emergency: new Uint8Array(32) })).rejects.toThrow('emergency keys');
  });
});

describe('role-based access', () => {
  it('gives every role exactly its sections', async () => {
    expect(await opens(sealed, await sectionKeysFor(sealed, 'emergency', emergency))).toEqual(['clinical', 'labs', 'medications']);
    for (const role of ['doctor', 'lab', 'pharmacy', 'emergency'] as const) {
      const keys = await grantFor(role);
      expect(Object.keys(keys).sort()).toEqual([...ROLE_SECTIONS[role]].sort());
      expect(await opens(sealed, keys)).toEqual([...ROLE_SECTIONS[role]].sort());
    }
  });

  it('enforces it with keys, not by leaving sections out', async () => {
    const [d, l, p] = [await grantFor('doctor'), await grantFor('lab'), await grantFor('pharmacy')];
    // A role's keys used on a section it was not given fail authentication.
    await expect(openRecord(sealed, { claimData: d.clinical })).rejects.toThrow('Cannot decrypt the claimData section');
    await expect(openRecord(sealed, { claim: d.labs })).rejects.toThrow('Cannot decrypt the claim section');
    await expect(openRecord(sealed, { medications: l.labs })).rejects.toThrow('Cannot decrypt the medications section');
    await expect(openRecord(sealed, { labs: p.medications })).rejects.toThrow('Cannot decrypt the labs section');
  });

  it('seals each key slot and grant to one identity only', async () => {
    await expect(sectionKeysFor(sealed, 'owner', hospital)).rejects.toThrow('wrong key');
    await expect(sectionKeysFor(sealed, 'emergency', stranger)).rejects.toThrow('wrong key');
    await expect(unwrapGrant(await grantKeyFor(sectionKeys, 'doctor', doctor.publicKey), stranger)).rejects.toThrow('wrong key');
  });

  it('cannot grant keys it does not hold', async () => {
    const labOnly = await grantFor('lab');
    await expect(grantKeyFor(labOnly, 'doctor', doctor.publicKey)).rejects.toThrow('Missing the clinical key');
    expect(Object.keys(await grantFor('lab', labOnly))).toEqual(['labs']);
  });

  it('rejects tampered or swapped sections and malformed records', async () => {
    const box = sealed.sections.labs;
    const flipped = box.ct.startsWith('A') ? `B${box.ct.slice(1)}` : `A${box.ct.slice(1)}`;
    await expect(openRecord({ ...sealed, sections: { ...sealed.sections, labs: { ...box, ct: flipped } } }, sectionKeys)).rejects.toThrow('labs section');
    const swapped = { ...sealed, sections: { ...sealed.sections, labs: sealed.sections.medications } };
    await expect(openRecord(swapped, { labs: sectionKeys.labs })).rejects.toThrow('labs section');
    await expect(openRecord({ ...sealed, v: 2 } as unknown as SealedRecord, sectionKeys)).rejects.toThrow('Not a sealed zkClaim record');
    await expect(openRecord(sealed, { labs: 'short' })).rejects.toThrow('Invalid key for the labs section');
    await expect(openRecord(sealed, { secrets: sectionKeys.labs } as SectionKeys)).rejects.toThrow('Unknown record section');
  });
});

describe('resealRecord', () => {
  it('rotates every key, so an old grant opens nothing in the new copy', async () => {
    const doctorKeys = await grantFor('doctor');
    const ownerKeys = await sectionKeysFor(sealed, 'owner', owner);
    const next = await resealRecord(sealed, ownerKeys, recipients);
    for (const part of Object.keys(sectionKeys) as (keyof SectionKeys)[]) expect(next.sectionKeys[part]).not.toBe(sectionKeys[part]);
    await expect(openRecord(next.sealed, doctorKeys)).rejects.toThrow('Cannot decrypt');
    const reopened = await openRecord(next.sealed, await sectionKeysFor(next.sealed, 'owner', owner));
    expect(reopened).toEqual({ sections: sectionsOf(bundle), claimData });
    expect(await opens(next.sealed, await grantFor('doctor', next.sectionKeys))).toEqual(['clinical', 'labs', 'medications']);
  });

  it('needs the keys of every section', async () => {
    await expect(resealRecord(sealed, await grantFor('doctor'), recipients)).rejects.toThrow('missing: claim, claimData');
  });
});
