// FHIR R4 (HL7) treatment records: what a hospital writes, seals and anchors.
import { encodeUtf8, stringify } from './bytes.js';
import { sha256 } from './crypto.js';

export type TreatmentInput = {
  patient: { name: string; birthDate: string; gender: 'male' | 'female' | 'other' };
  /** `start` is an ISO date-time. */
  encounter: { start: string; hospital: string };
  /** ICD-10 */
  diagnosis: { code: string; display: string };
  /** CPT; goes on-chain as the record's procedureCode (Uint<32>), so 0 is never valid. */
  procedure: { code: number; display: string };
  /** RxNorm */
  medications: { code: string; display: string; dosage: string }[];
  /** LOINC, UCUM units */
  labs: { code: string; display: string; value: number; unit: string }[];
  /** Claim amount in NIGHT base units (1 NIGHT = 1_000_000 units). */
  amount: bigint;
};

export type FhirResource = { resourceType: string; id: string; [k: string]: unknown };
export type FhirBundle = { resourceType: 'Bundle'; type: 'collection'; entry: { fullUrl: string; resource: FhirResource }[] };
export type Section = 'clinical' | 'labs' | 'medications' | 'claim';

export const PROCEDURES: { code: number; display: string }[] = [
  { code: 92928, display: 'Coronary angioplasty with stent placement' },
  { code: 33533, display: 'Coronary artery bypass graft (CABG)' },
  { code: 27447, display: 'Total knee replacement' },
  { code: 47562, display: 'Laparoscopic gallbladder removal (cholecystectomy)' },
  { code: 70551, display: 'MRI of the brain without contrast' },
  { code: 99285, display: 'Emergency department visit, high severity' },
  { code: 59400, display: 'Maternity care with vaginal delivery' },
  { code: 15780, display: 'Dermabrasion of the face (cosmetic)' },
];

/** Same order as PROCEDURES: DIAGNOSES[i] is the usual reason for PROCEDURES[i]. */
export const DIAGNOSES: { code: string; display: string }[] = [
  { code: 'I21.4', display: 'Non-ST elevation myocardial infarction (NSTEMI)' },
  { code: 'I25.10', display: 'Atherosclerotic heart disease of native coronary artery' },
  { code: 'M17.11', display: 'Primary osteoarthritis, right knee' },
  { code: 'K80.20', display: 'Gallstones without cholecystitis or obstruction' },
  { code: 'R51.9', display: 'Headache, unspecified' },
  { code: 'R07.9', display: 'Chest pain, unspecified' },
  { code: 'O80', display: 'Full-term uncomplicated delivery' },
  { code: 'L70.0', display: 'Acne vulgaris' },
];

const NIGHT = 1_000_000n;
const HOSPITAL = 'Midnight General Hospital';

/** Fictional patients. */
export const SAMPLE_CASES: { id: string; title: string; input: TreatmentInput }[] = [
  {
    id: 'cardiac',
    title: 'Heart attack treated with a coronary stent',
    input: {
      patient: { name: 'Elena Marsh', birthDate: '1961-03-14', gender: 'female' },
      encounter: { start: '2026-11-03T07:42:00Z', hospital: HOSPITAL },
      diagnosis: { code: 'I21.4', display: 'Non-ST elevation myocardial infarction (NSTEMI)' },
      procedure: { code: 92928, display: 'Coronary angioplasty with stent placement' },
      medications: [
        { code: '309362', display: 'Clopidogrel 75 MG Oral Tablet', dosage: '75 mg by mouth once daily for 12 months' },
        { code: '243670', display: 'Aspirin 81 MG Oral Tablet', dosage: '81 mg by mouth once daily' },
        { code: '259255', display: 'Atorvastatin 80 MG Oral Tablet', dosage: '80 mg by mouth once daily at bedtime' },
      ],
      labs: [
        { code: '10839-9', display: 'Troponin I (cardiac)', value: 4.2, unit: 'ng/mL' },
        { code: '13457-7', display: 'LDL cholesterol (calculated)', value: 162, unit: 'mg/dL' },
        { code: '718-7', display: 'Hemoglobin', value: 13.6, unit: 'g/dL' },
      ],
      amount: 400n * NIGHT,
    },
  },
  {
    id: 'cosmetic',
    title: 'Cosmetic dermabrasion',
    input: {
      patient: { name: 'Jonah Reyes', birthDate: '1994-08-22', gender: 'male' },
      encounter: { start: '2026-11-10T14:00:00Z', hospital: HOSPITAL },
      diagnosis: { code: 'L70.0', display: 'Acne vulgaris' },
      procedure: { code: 15780, display: 'Dermabrasion of the face (cosmetic)' },
      medications: [{ code: '198440', display: 'Acetaminophen 500 MG Oral Tablet', dosage: '500 mg by mouth every 6 hours as needed for pain' }],
      labs: [],
      amount: 120n * NIGHT,
    },
  },
  {
    id: 'knee',
    title: 'Total knee replacement',
    input: {
      patient: { name: 'Priya Raman', birthDate: '1957-11-30', gender: 'female' },
      encounter: { start: '2026-11-12T09:15:00Z', hospital: HOSPITAL },
      diagnosis: { code: 'M17.11', display: 'Primary osteoarthritis, right knee' },
      procedure: { code: 27447, display: 'Total knee replacement' },
      medications: [
        { code: '1049621', display: 'Oxycodone Hydrochloride 5 MG Oral Tablet', dosage: '5 mg by mouth every 6 hours as needed for severe pain, up to 5 days' },
        { code: '205323', display: 'Celecoxib 200 MG Oral Capsule', dosage: '200 mg by mouth once daily for 2 weeks' },
      ],
      labs: [
        { code: '718-7', display: 'Hemoglobin', value: 12.1, unit: 'g/dL' },
        { code: '2160-0', display: 'Creatinine', value: 0.9, unit: 'mg/dL' },
        { code: '4548-4', display: 'Hemoglobin A1c', value: 5.6, unit: '%' },
      ],
      amount: 350n * NIGHT,
    },
  },
];

const ICD10 = 'http://hl7.org/fhir/sid/icd-10';
const CPT = 'http://www.ama-assn.org/go/cpt';
const LOINC = 'http://loinc.org';
const RXNORM = 'http://www.nlm.nih.gov/research/umls/rxnorm';
const UCUM = 'http://unitsofmeasure.org';
const HL7 = 'http://terminology.hl7.org/CodeSystem/';

const ENCOUNTER_CLASS: Record<number, [string, string]> = { 99285: ['EMER', 'emergency'], 70551: ['AMB', 'ambulatory'], 15780: ['AMB', 'ambulatory'] };

const concept = (system: string, code: string, display: string) => ({ coding: [{ system, code, display }], text: display });
const ref = (r: FhirResource) => ({ reference: `urn:uuid:${r.id}` });
const make = (resourceType: string, body: Record<string, unknown>): FhirResource => ({ resourceType, id: crypto.randomUUID(), ...body });

function checkInput(i: TreatmentInput): void {
  const fail = (what: string): never => {
    throw new Error(`Invalid treatment input: ${what}`);
  };
  if (!i?.patient?.name?.trim()) fail('patient.name is empty');
  if (!/^\d{4}(-\d{2}(-\d{2})?)?$/.test(i.patient.birthDate)) fail('patient.birthDate must be YYYY-MM-DD');
  if (!['male', 'female', 'other'].includes(i.patient.gender)) fail('patient.gender must be male, female or other');
  if (Number.isNaN(Date.parse(i.encounter?.start))) fail('encounter.start must be an ISO date-time');
  if (!i.encounter.hospital?.trim()) fail('encounter.hospital is empty');
  if (!i.diagnosis?.code?.trim()) fail('diagnosis.code is empty');
  if (!Number.isInteger(i.procedure?.code) || i.procedure.code <= 0 || i.procedure.code >= 2 ** 32) fail('procedure.code must be a positive CPT number');
  if (typeof i.amount !== 'bigint' || i.amount <= 0n || i.amount >= 2n ** 64n) fail('amount must be a positive bigint below 2^64');
  if (!Array.isArray(i.medications) || !Array.isArray(i.labs)) fail('medications and labs must be arrays');
  for (const l of i.labs) if (!Number.isFinite(l.value)) fail(`lab ${l.code} needs a numeric value`);
}

/**
 * One treatment as a FHIR R4 collection bundle. Resource ids are fresh UUIDs, so build once and
 * hash, seal and anchor that same bundle object.
 */
export function buildBundle(input: TreatmentInput): FhirBundle {
  checkInput(input);
  const { patient: p, encounter: e, diagnosis: dx, procedure: px } = input;
  const at = e.start;
  const names = p.name.trim().split(/\s+/);
  const patient = make('Patient', {
    name: [{ use: 'official', text: names.join(' '), family: names.at(-1), ...(names.length > 1 ? { given: names.slice(0, -1) } : {}) }],
    gender: p.gender,
    birthDate: p.birthDate,
  });
  const subject = ref(patient);
  const [classCode, classDisplay] = ENCOUNTER_CLASS[px.code] ?? ['IMP', 'inpatient encounter'];
  const encounter = make('Encounter', {
    status: 'finished',
    class: { system: `${HL7}v3-ActCode`, code: classCode, display: classDisplay },
    subject,
    period: { start: at },
    serviceProvider: { display: e.hospital },
  });
  const context = { subject, encounter: ref(encounter) };
  const condition = make('Condition', {
    clinicalStatus: concept(`${HL7}condition-clinical`, 'active', 'Active'),
    verificationStatus: concept(`${HL7}condition-ver-status`, 'confirmed', 'Confirmed'),
    category: [concept(`${HL7}condition-category`, 'encounter-diagnosis', 'Encounter Diagnosis')],
    code: concept(ICD10, dx.code, dx.display),
    ...context,
    recordedDate: at,
  });
  const cpt = concept(CPT, String(px.code).padStart(5, '0'), px.display);
  const procedure = make('Procedure', { status: 'completed', code: cpt, ...context, performedDateTime: at, reasonReference: [ref(condition)] });
  const labs = input.labs.map((l) =>
    make('Observation', {
      status: 'final',
      category: [concept(`${HL7}observation-category`, 'laboratory', 'Laboratory')],
      code: concept(LOINC, l.code, l.display),
      ...context,
      effectiveDateTime: at,
      valueQuantity: { value: l.value, unit: l.unit, system: UCUM, code: l.unit },
    }),
  );
  const medications = input.medications.map((m) =>
    make('MedicationRequest', {
      status: 'active',
      intent: 'order',
      medicationCodeableConcept: concept(RXNORM, m.code, m.display),
      ...context,
      authoredOn: at,
      dosageInstruction: [{ text: m.dosage }],
    }),
  );
  // FHIR Money is a decimal for display; the exact base-unit amount lives in ClaimData.
  const money = () => ({ value: Number(input.amount) / 1e6, currency: 'NIGHT' });
  const claim = make('Claim', {
    status: 'active',
    type: concept(`${HL7}claim-type`, 'institutional', 'Institutional'),
    use: 'claim',
    patient: subject,
    created: at,
    provider: { display: e.hospital },
    priority: concept(`${HL7}processpriority`, 'normal', 'Normal'),
    insurance: [{ sequence: 1, focal: true, coverage: { display: 'zkClaim private policy (only its commitment is on-chain)' } }],
    diagnosis: [{ sequence: 1, diagnosisReference: ref(condition) }],
    procedure: [{ sequence: 1, procedureReference: ref(procedure) }],
    item: [{ sequence: 1, diagnosisSequence: [1], procedureSequence: [1], productOrService: cpt, encounter: [ref(encounter)], net: money() }],
    total: money(),
  });
  // Section order (clinical, labs, medications, claim), so the bundle can be rebuilt from its sections.
  const resources = [patient, encounter, condition, procedure, ...labs, ...medications, claim];
  return { resourceType: 'Bundle', type: 'collection', entry: resources.map((resource) => ({ fullUrl: `urn:uuid:${resource.id}`, resource })) };
}

const SECTION_OF = new Map<string, Section>([
  ['Patient', 'clinical'],
  ['Encounter', 'clinical'],
  ['Condition', 'clinical'],
  ['Procedure', 'clinical'],
  ['Observation', 'labs'],
  ['MedicationRequest', 'medications'],
  ['Claim', 'claim'],
]);

/** Throws on a resource type with no section, rather than silently leaving it out of the sealed record. */
export function sectionsOf(bundle: FhirBundle): Record<Section, FhirResource[]> {
  const out: Record<Section, FhirResource[]> = { clinical: [], labs: [], medications: [], claim: [] };
  if (!Array.isArray(bundle?.entry)) throw new Error('Not a FHIR bundle: entry is missing');
  for (const { resource } of bundle.entry) {
    const section = SECTION_OF.get(resource?.resourceType);
    if (!section) throw new Error(`No record section for FHIR resource type ${resource?.resourceType}`);
    out[section].push(resource);
  }
  return out;
}

/** SHA-256 of the canonical JSON: the record's contentHash on-chain. */
export async function contentHash(bundle: FhirBundle): Promise<Uint8Array> {
  return sha256(encodeUtf8(stringify(bundle)));
}
