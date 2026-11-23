// Sealed records, as stored on IPFS: every section has its own AES-256-GCM key, so a key set
// opens exactly the sections its role may read.
import { decodeUtf8, encodeUtf8, fromBase64Url, isBytes32, parse, stringify, toBase64Url, toHex } from './bytes.js';
import { aesOpen, aesSeal, type Box, type EncIdentity, openSealed, randomBytes, sealTo } from './crypto.js';
import { contentHash, type FhirBundle, type FhirResource, type Section, sectionsOf } from './fhir.js';

export type Role = 'owner' | 'hospital' | 'doctor' | 'lab' | 'pharmacy' | 'emergency';
type Part = Section | 'claimData';
const PARTS: readonly Part[] = ['clinical', 'labs', 'medications', 'claim', 'claimData'];

export const ROLE_SECTIONS: Record<Role, Part[]> = {
  owner: [...PARTS],
  hospital: [...PARTS],
  doctor: ['clinical', 'labs', 'medications'],
  emergency: ['clinical', 'labs', 'medications'],
  lab: ['labs'],
  pharmacy: ['medications'],
};

/** On-chain Grant.role values (Uint<8>: pass BigInt(ROLE_CODES.doctor) to the contract). */
export const ROLE_CODES = { doctor: 1, lab: 2, pharmacy: 3, emergency: 4 } as const;

/** The contract's TreatmentRecord plus its salt: what the hospital and patient need to claim. */
export type ClaimData = {
  record: { patientPk: Uint8Array; hospitalPk: Uint8Array; procedureCode: bigint; amount: bigint; contentHash: Uint8Array };
  salt: Uint8Array;
};
/** Raw 32-byte AES keys, base64url. */
export type SectionKeys = Partial<Record<Part, string>>;
/** keys.* = sealTo(recipient, stringify(that role's SectionKeys)). */
export type SealedRecord = { v: 1; sections: Record<Part, Box>; keys: { owner: string; hospital: string; emergency: string } };
type Recipients = { owner: Uint8Array; hospital: Uint8Array; emergency: Uint8Array };
type Opened = { sections: Partial<Record<Section, FhirResource[]>>; claimData?: ClaimData };

const aad = (part: Part) => encodeUtf8(`zkclaim:record:v1:${part}`);

function checkClaimData(c: ClaimData): ClaimData {
  const r = c?.record;
  const ok =
    isBytes32(r?.patientPk) && isBytes32(r.hospitalPk) && isBytes32(r.contentHash) && isBytes32(c.salt) &&
    typeof r.procedureCode === 'bigint' && typeof r.amount === 'bigint';
  if (!ok) throw new Error('Invalid claim data: needs 32-byte patientPk, hospitalPk, contentHash and salt, and bigint procedureCode and amount');
  return c;
}

/** Validates a key set and drops undefined entries. */
function checkKeys(keys: unknown): SectionKeys {
  if (keys === null || typeof keys !== 'object' || Array.isArray(keys)) throw new Error('Section keys must be an object');
  const out: SectionKeys = {};
  for (const [part, key] of Object.entries(keys)) {
    if (key === undefined) continue;
    if (!PARTS.includes(part as Part)) throw new Error(`Unknown record section: ${part}`);
    if (typeof key !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(key)) throw new Error(`Invalid key for the ${part} section`);
    out[part as Part] = key;
  }
  return out;
}

function checkSealed(s: SealedRecord): void {
  if (s?.v !== 1 || typeof s.keys !== 'object' || typeof s.sections !== 'object') throw new Error('Not a sealed zkClaim record (v1)');
  for (const part of PARTS) {
    const box = s.sections[part];
    if (typeof box?.iv !== 'string' || typeof box.ct !== 'string') throw new Error(`Sealed record is missing the ${part} section`);
  }
}

/** The keys `role` may hold, as sealTo plaintext. */
function keysForRole(keys: SectionKeys, role: Role): Uint8Array {
  const out: SectionKeys = {};
  for (const part of ROLE_SECTIONS[role]) {
    if (!keys[part]) throw new Error(`Missing the ${part} key, which the ${role} role needs`);
    out[part] = keys[part];
  }
  return encodeUtf8(stringify(out));
}

async function sealParts(parts: Record<Part, unknown>, to: Recipients): Promise<{ sealed: SealedRecord; sectionKeys: SectionKeys }> {
  const sectionKeys: SectionKeys = {};
  const sections = {} as Record<Part, Box>;
  for (const part of PARTS) {
    const key = randomBytes(32);
    sections[part] = await aesSeal(key, encodeUtf8(stringify(parts[part])), aad(part));
    sectionKeys[part] = toBase64Url(key);
  }
  const seal = (role: 'owner' | 'hospital' | 'emergency') => sealTo(to?.[role], keysForRole(sectionKeys, role)).catch((e: Error) => {
    throw new Error(`Cannot seal the ${role} keys: ${e.message}`);
  });
  const keys = { owner: await seal('owner'), hospital: await seal('hospital'), emergency: await seal('emergency') };
  return { sealed: { v: 1, sections, keys }, sectionKeys };
}

/** Fresh random key per section. claimData.record.contentHash must be contentHash(bundle). */
export async function sealRecord(bundle: FhirBundle, claimData: ClaimData, recipients: Recipients): Promise<{ sealed: SealedRecord; sectionKeys: SectionKeys }> {
  checkClaimData(claimData);
  if (toHex(await contentHash(bundle)) !== toHex(claimData.record.contentHash)) {
    throw new Error('claimData.record.contentHash is not contentHash(bundle): hash the exact bundle you seal');
  }
  return sealParts({ ...sectionsOf(bundle), claimData }, recipients);
}

async function readKeys(sealed: string, identity: EncIdentity): Promise<SectionKeys> {
  return checkKeys(parse(decodeUtf8(await openSealed(sealed, identity))));
}

export async function sectionKeysFor(sealed: SealedRecord, as: 'owner' | 'hospital' | 'emergency', identity: EncIdentity): Promise<SectionKeys> {
  checkSealed(sealed);
  const slot = (sealed.keys as Record<string, unknown>)[as];
  if (typeof slot !== 'string' || !['owner', 'hospital', 'emergency'].includes(as)) throw new Error(`Sealed record has no key slot for ${as}`);
  return readKeys(slot, identity);
}

/** The `wrappedKey` for grantAccess: only `role`'s section keys, sealed to the grantee. */
export async function grantKeyFor(sectionKeys: SectionKeys, role: 'doctor' | 'lab' | 'pharmacy' | 'emergency', granteePublicKey: Uint8Array): Promise<string> {
  if (!Object.hasOwn(ROLE_CODES, role)) throw new Error(`Unknown grant role: ${role}`);
  return sealTo(granteePublicKey, keysForRole(checkKeys(sectionKeys), role));
}

export async function unwrapGrant(wrapped: string, identity: EncIdentity): Promise<SectionKeys> {
  return readKeys(wrapped, identity);
}

/** Decrypts only the sections `keys` cover; any wrong key or tampered section throws. */
export async function openRecord(sealed: SealedRecord, keys: SectionKeys): Promise<Opened> {
  checkSealed(sealed);
  const out: Opened = { sections: {} };
  for (const [part, key] of Object.entries(checkKeys(keys)) as [Part, string][]) {
    let plain: Uint8Array;
    try {
      plain = await aesOpen(fromBase64Url(key), sealed.sections[part], aad(part));
    } catch {
      throw new Error(`Cannot decrypt the ${part} section: wrong key or tampered data`);
    }
    const value = parse<unknown>(decodeUtf8(plain));
    if (part === 'claimData') out.claimData = checkClaimData(value as ClaimData);
    else if (Array.isArray(value)) out.sections[part] = value as FhirResource[];
    else throw new Error(`The ${part} section is not a list of FHIR resources`);
  }
  return out;
}

/** Revocation: decrypt everything, re-encrypt under fresh keys. Every earlier grant stops opening the new copy. */
export async function resealRecord(sealed: SealedRecord, ownerKeys: SectionKeys, recipients: Recipients): Promise<{ sealed: SealedRecord; sectionKeys: SectionKeys }> {
  const { sections, claimData } = await openRecord(sealed, ownerKeys);
  const parts = { ...sections, claimData };
  const missing = PARTS.filter((p) => parts[p] === undefined);
  if (missing.length) throw new Error(`resealRecord needs the owner or hospital keys; missing: ${missing.join(', ')}`);
  return sealParts(parts as Record<Part, unknown>, recipients);
}
