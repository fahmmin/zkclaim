// The one interface every screen talks to. DemoService runs the real circuits in this tab; LiveService goes
// through the 1AM wallet to the devnet. Screens never know which one they have.
import { type FhirResource, PROCEDURES as CPT, ROLE_SECTIONS as LIB_ROLE_SECTIONS, type Section, type TreatmentInput } from '@zkclaim/records';

export type { TreatmentInput };
export type Mode = 'demo' | 'live';
export type GranteeRole = 'doctor' | 'lab' | 'pharmacy';
export type AccessRole = GranteeRole | 'emergency';
export type SectionName = Section;

export type Procedure = { code: number; name: string };

export type Hospital = { id: string; name: string; pk: string; approved: boolean; index: number | null; note: string };

/** The virtual policy card: what the patient carries and shows to a hospital. */
export type PolicyCard = {
  policyNo: string;
  holderName: string;
  holderPk: string;
  insurer: string;
  plan: string;
  limit: bigint;
  expiresAt: number;
  covered: number[];
  /** The policy commitment on-chain: the only thing the ledger knows about this card. */
  fingerprint: string;
  issuedAt: number;
  /** Card code for the QR and for pasting at a hospital desk. */
  code: string;
};

export type RecordStatus = 'anchored' | 'consented' | 'paid';

/** Readable lines per decrypted section. */
export type RecordSections = Partial<Record<SectionName, string[]>>;

/** A treatment record as the patient and the treating hospital see it, after decrypting. */
export type MedicalRecord = {
  id: string;
  cid: string;
  patientName: string;
  hospitalId: string;
  hospitalName: string;
  createdAt: number;
  procedure: Procedure;
  amount: bigint;
  sections: RecordSections;
  status: RecordStatus;
  /** Sealed to the patient, so the patient's device found and opened it. */
  mine: boolean;
  /** This device withdrew the patient's permission (on-chain there is simply no consent now). */
  withdrawn: boolean;
};

/** A settled claim. The first five fields are all the insurer ever learns. */
export type Claim = {
  nullifier: string;
  policy: string;
  amount: bigint;
  at: number;
  hospitalRoot: string;
  /** The payout address, public in the transaction (payouts are unshielded). */
  payTo: string | null;
  /** Known to the hospital and patient only; never shown on the insurer desk. */
  recordId: string | null;
  hospitalId: string | null;
};

export type Grant = { record: string; role: AccessRole; grantee: string; granteePk: string; grantedAt: number; expiresAt: number | null; revokedAt: number | null };

export type AuditKind = 'granted' | 'revoked' | 'viewed' | 'breakGlass';
export type AuditEntry = { kind: AuditKind; record: string; actor: string; at: number; detail: string };

export type Responder = { id: string; name: string; pk: string; approved: boolean };

export type OpenedRecord = { recordId: string; role: AccessRole; visible: SectionName[]; sections: RecordSections; until: number; title: string };

/** Live mode only: the wallet and storage this browser is using. */
export type LiveInfo = {
  networkId: string;
  wallet: string | null;
  address: string | null;
  night: bigint;
  dust: bigint;
  ipfs: 'kubo' | 'browser' | null;
  savedContract: string | null;
};

export type Snapshot = {
  mode: Mode;
  ready: boolean;
  network: string;
  contract: string;
  now: number;
  funded: bigint;
  paid: bigint;
  hospitals: Hospital[];
  hospitalRoot: string;
  desk: string;
  policies: PolicyCard[];
  patientName: string;
  card: PolicyCard | null;
  records: MedicalRecord[];
  claims: Claim[];
  grants: Grant[];
  audit: AuditEntry[];
  emergencyKey: string | null;
  responders: Responder[];
  people: Record<AccessRole, string>;
  busy: string | null;
  live?: LiveInfo;
};

export type IssueInput = { holderName: string; plan: string; limit: bigint; validDays: number; covered: number[] };

export type Admission = { card: PolicyCard; onChain: boolean; expired: boolean; spent: bigint };

export interface ZkClaimService {
  readonly mode: Mode;
  subscribe(listener: () => void): () => void;
  snapshot(): Snapshot;
  // insurer
  fundPool(amount: bigint): Promise<void>;
  approveHospital(id: string): Promise<void>;
  removeHospital(id: string): Promise<void>;
  issuePolicy(input: IssueInput): Promise<PolicyCard>;
  setResponder(id: string, approved: boolean): Promise<void>;
  // hospital
  setDesk(hospitalId: string): void;
  admit(code: string): Promise<Admission>;
  createRecord(card: PolicyCard, input: TreatmentInput): Promise<MedicalRecord>;
  submitClaim(recordId: string): Promise<Claim>;
  // patient
  consent(recordId: string): Promise<void>;
  /** Takes the permission back while the claim is unpaid; refused with "Claim already settled" once it is paid. */
  withdrawConsent(recordId: string): Promise<void>;
  grantAccess(recordId: string, role: GranteeRole, seconds: number): Promise<void>;
  revokeAccess(recordId: string, role: GranteeRole): Promise<void>;
  // doctor, lab, pharmacy, emergency
  openShared(recordId: string, role: GranteeRole): Promise<OpenedRecord>;
  breakGlass(recordId: string, reason: string, responderId?: string): Promise<OpenedRecord>;
  // demo controls
  reset(): Promise<void>;
  /** `judge`: two consented, unpaid claims instead of one waiting for consent (the withdraw demo). */
  seedStory(judge?: boolean): Promise<void>;
  skipAhead(seconds: number): void;
}

// ---------- Catalogue (from @zkclaim/records) ----------

export const PROCEDURES: Procedure[] = CPT.map((p) => ({ code: p.code, name: p.display }));
export const procedureName = (code: number) => PROCEDURES.find((p) => p.code === code)?.name ?? `CPT ${code}`;
export const COSMETIC = 15780;

const SHORT: Record<number, string> = {
  92928: 'Angioplasty & stent',
  33533: 'Heart bypass',
  27447: 'Knee replacement',
  47562: 'Gallbladder removal',
  70551: 'Brain MRI',
  99285: 'Emergency visit',
  59400: 'Maternity',
  15780: 'Cosmetic dermabrasion',
};
/** Chip-sized procedure names. */
export const procedureShort = (code: number) => SHORT[code] ?? procedureName(code);

/** Which parts of a record each role may decrypt (claimData is internal, never shown). */
export const ROLE_SECTIONS = Object.fromEntries(
  Object.entries(LIB_ROLE_SECTIONS).map(([role, parts]) => [role, parts.filter((p): p is SectionName => p !== 'claimData')]),
) as Record<AccessRole | 'owner' | 'hospital', SectionName[]>;

export const SECTION_TITLES: Record<SectionName, string> = {
  clinical: 'Diagnosis & procedure',
  labs: 'Lab results',
  medications: 'Medications',
  claim: 'Bill',
};

export const ROLE_TITLES: Record<AccessRole, string> = { doctor: 'Doctor', lab: 'Lab', pharmacy: 'Pharmacy', emergency: 'Emergency' };

// ---------- FHIR to readable lines ----------

type Coded = { text?: string; coding?: { code?: string }[] };
const txt = (c: unknown) => (c as Coded | undefined)?.text ?? '';
const code = (c: unknown) => (c as Coded | undefined)?.coding?.[0]?.code ?? '';

function line(r: FhirResource): string | null {
  const x = r as Record<string, unknown> & FhirResource;
  switch (r.resourceType) {
    case 'Patient': {
      const name = (x.name as { text?: string }[] | undefined)?.[0]?.text ?? '';
      return `Patient: ${name}, born ${x.birthDate}`;
    }
    case 'Encounter':
      return `Admitted ${String((x.period as { start?: string })?.start ?? '').slice(0, 10)} at ${(x.serviceProvider as { display?: string })?.display ?? ''}`;
    case 'Condition':
      return `Diagnosis: ${txt(x.code)} (ICD-10 ${code(x.code)})`;
    case 'Procedure':
      return `Procedure: ${txt(x.code)} (CPT ${code(x.code)})`;
    case 'Observation': {
      const q = x.valueQuantity as { value?: number; unit?: string } | undefined;
      return `${txt(x.code)}: ${q?.value ?? ''} ${q?.unit ?? ''}`.trim();
    }
    case 'MedicationRequest':
      return `${txt(x.medicationCodeableConcept)}: ${(x.dosageInstruction as { text?: string }[] | undefined)?.[0]?.text ?? ''}`;
    case 'Claim':
      return `Billed ${(x.total as { value?: number })?.value?.toLocaleString('en-US') ?? ''} NIGHT, ${(x.provider as { display?: string })?.display ?? ''}`;
    default:
      return null;
  }
}

export function describe(sections: Partial<Record<SectionName, FhirResource[]>>): RecordSections {
  const out: RecordSections = {};
  for (const [name, resources] of Object.entries(sections) as [SectionName, FhirResource[]][]) {
    out[name] = resources.map(line).filter((l): l is string => !!l);
  }
  return out;
}

/** The patient's name and the hospital from a decrypted clinical section, when the viewer may see it. */
export function headline(sections: Partial<Record<SectionName, FhirResource[]>>) {
  const clinical = sections.clinical ?? [];
  const patient = clinical.find((r) => r.resourceType === 'Patient') as { name?: { text?: string }[] } | undefined;
  const encounter = clinical.find((r) => r.resourceType === 'Encounter') as { period?: { start?: string }; serviceProvider?: { display?: string } } | undefined;
  return {
    patientName: patient?.name?.[0]?.text ?? '',
    hospitalName: encounter?.serviceProvider?.display ?? '',
    at: encounter?.period?.start ? Math.floor(Date.parse(encounter.period.start) / 1000) : 0,
  };
}

// ---------- Formatting ----------

const UNITS = 1_000_000n;

/** NIGHT amounts from base units (6 decimals), exact. */
export function night(units: bigint, withUnit = true): string {
  const sign = units < 0n ? '-' : '';
  const abs = units < 0n ? -units : units;
  const whole = (abs / UNITS).toLocaleString('en-US');
  const frac = (abs % UNITS).toString().padStart(6, '0').replace(/0+$/, '');
  return `${sign}${whole}${frac ? '.' + frac : ''}${withUnit ? ' NIGHT' : ''}`;
}

/** Parses "1,250.5" NIGHT into base units; null when it is not a positive amount. */
export function parseNight(text: string): bigint | null {
  const m = text.replace(/[,\s]/g, '').match(/^(\d+)(?:\.(\d{0,6}))?$/);
  if (!m) return null;
  const units = BigInt(m[1]) * UNITS + BigInt((m[2] ?? '').padEnd(6, '0'));
  return units > 0n ? units : null;
}

export const short = (hex: string, head = 6, tail = 4) => (hex.length <= head + tail + 1 ? hex : `${hex.slice(0, head)}…${hex.slice(-tail)}`);

/** Human-sized fingerprint of a 32-byte value, e.g. 7F3A-9C21. */
export const fingerprint = (hex: string) => `${hex.slice(0, 4)}-${hex.slice(4, 8)}`.toUpperCase();

export const date = (s: number) => new Date(s * 1000).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
export const time = (s: number) => new Date(s * 1000).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

export function until(s: number, now: number): string {
  const d = s - now;
  if (d <= 0) return 'expired';
  if (d < 3600) return `${Math.ceil(d / 60)} min left`;
  if (d < 86_400) return `${Math.round(d / 3600)} h left`;
  const days = Math.round(d / 86_400);
  return days === 1 ? '1 day left' : `${days} days left`;
}

/** The contract's own rejection text (Midnight.js nests it in `cause`), without the runtime's "failed assert:" prefix. */
export function reason(e: unknown): string {
  const messages: string[] = [];
  for (let x: unknown = e; x && messages.length < 6; x = (x as { cause?: unknown }).cause) messages.push(x instanceof Error ? x.message : String(x));
  const hit = messages.find((m) => m.includes('failed assert:'));
  return hit ? hit.replace(/^.*failed assert:\s*/s, '') : messages.join(' ← ');
}

export const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
export const unhex = (h: string) => Uint8Array.from(h.match(/../g) ?? [], (x) => parseInt(x, 16));
