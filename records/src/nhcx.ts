// NHCX ClaimResponseBundle (NRCeS FHIR IG for ABDM 6.5.0) for one settled claim. It names the
// patient, so it is an access-controlled copy for the hospital and the patient: never part of the
// public settlement receipt, and separate from fhir.ts, whose bundles are hashed and anchored.
import type { FhirBundle, FhirResource, TreatmentInput } from './fhir.js';

export type NhcxClaimResponseInput = {
  /** The public on-chain settlement, claims[nullifier] = { policy, amount, at }. */
  settlement: {
    /** 32-byte values as lowercase hex. */
    nullifier: string;
    policyCommitment: string;
    /** NIGHT base units (1 NIGHT = 1_000_000 units). */
    amount: bigint;
    /** Unix seconds. */
    settledAt: bigint;
  };
  /** The hospital's own off-chain claim. Only the patient's name, gender and birth date and the hospital's name are copied. */
  claim: TreatmentInput;
  /** The claim's business value, entered separately (synthetic in this build), never converted from NIGHT. */
  amount: { value: number; currency: 'INR' };
  insurer: string;
  /** Local identifiers, under example.org systems. Not ABHA, Aadhaar or registry numbers. */
  ids: { patient: string; hospital: string; insurer: string };
};

const PROFILE = 'https://nrces.in/ndhm/fhir/r4/StructureDefinition/';
const SID = 'https://example.org/fhir/sid/';
const HL7 = 'http://terminology.hl7.org/CodeSystem/';
const SNOMED = 'http://snomed.info/sct';
// The CPT codes fhir.ts files as emergency or ambulatory encounters; every other claim is inpatient.
const OUTPATIENT = new Set([99285, 70551, 15780]);

const concept = (system: string, code: string, display: string) => ({ coding: [{ system, code, display }] });
const ref = (r: FhirResource) => ({ reference: `urn:uuid:${r.id}` });
const xml = (v: unknown) => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
/** A generated XHTML narrative (FHIR dom-6), with every interpolated value escaped. */
const narrative = (parts: TemplateStringsArray, ...values: unknown[]) => ({
  status: 'generated',
  div: `<div xmlns="http://www.w3.org/1999/xhtml">${parts.reduce((out, part, i) => out + xml(values[i - 1]) + part)}</div>`,
});
const make = (resourceType: string, text: ReturnType<typeof narrative>, body: Record<string, unknown>): FhirResource => ({
  resourceType,
  id: crypto.randomUUID(),
  meta: { profile: [PROFILE + resourceType] },
  text,
  ...body,
});
const identifier = (code: string, display: string, system: string, value: string) => ({ type: concept(`${HL7}v2-0203`, code, display), system: SID + system, value });

function check(i: NhcxClaimResponseInput): void {
  const fail = (what: string): never => {
    throw new Error(`Invalid NHCX claim response input: ${what}`);
  };
  const s = i?.settlement;
  const hex32 = /^[0-9a-f]{64}$/;
  if (!hex32.test(s?.nullifier) || !hex32.test(s.policyCommitment)) fail('settlement.nullifier and policyCommitment must be 32 bytes of lowercase hex');
  if (typeof s.amount !== 'bigint' || s.amount <= 0n) fail('settlement.amount must be a positive bigint of NIGHT base units');
  if (typeof s.settledAt !== 'bigint' || s.settledAt <= 0n || s.settledAt >= 253_402_300_800n) fail('settlement.settledAt must be Unix seconds as a bigint');
  if (i.claim?.amount !== s.amount) fail('settlement.amount is not claim.amount, so this settlement is for another claim');
  if (i.amount?.currency !== 'INR') fail('amount.currency must be INR; NIGHT is not a currency');
  const v = i.amount.value;
  if (typeof v !== 'number' || !(v > 0) || !/^\d+(\.\d{1,2})?$/.test(String(v))) fail('amount.value must be a positive rupee amount with at most 2 decimals');
  const text = [i.claim.patient?.name, i.claim.encounter?.hospital, i.insurer, i.ids?.patient, i.ids?.hospital, i.ids?.insurer];
  if (!text.every((t) => typeof t === 'string' && t.trim())) fail('patient, hospital and insurer names and ids must not be empty');
}

/** Resource ids are fresh UUIDs. Every Money is the explicit INR amount; the NIGHT payout appears only as labelled text. */
export function buildNhcxClaimResponseBundle(input: NhcxClaimResponseInput): FhirBundle & { meta: object; timestamp: string } {
  check(input);
  const { settlement: s, claim: c, ids } = input;
  const at = new Date(Number(s.settledAt) * 1000).toISOString();
  const inr = () => ({ value: input.amount.value, currency: 'INR' });
  const [patientName, hospitalName, insurerName] = [c.patient.name, c.encounter.hospital, input.insurer].map((t) => t.trim());
  const patient = make('Patient', narrative`${patientName}, ${c.patient.gender}, born ${c.patient.birthDate}. Medical record number ${ids.patient}.`, {
    identifier: [identifier('MR', 'Medical record number', 'patient-mrn', ids.patient)],
    name: [{ text: patientName }],
    gender: c.patient.gender,
    birthDate: c.patient.birthDate,
  });
  const insurer = make('Organization', narrative`${insurerName}, insurance company. Identifier ${ids.insurer}.`, {
    identifier: [identifier('XX', 'Organization identifier', 'insurer-id', ids.insurer)],
    type: [concept(`${HL7}organization-type`, 'ins', 'Insurance Company')],
    name: insurerName,
  });
  const hospital = make('Organization', narrative`${hospitalName}, healthcare provider. Identifier ${ids.hospital}.`, {
    identifier: [identifier('PRN', 'Provider number', 'hospital-id', ids.hospital)],
    type: [concept(`${HL7}organization-type`, 'prov', 'Healthcare Provider')],
    name: hospitalName,
  });
  const coverage = make('Coverage', narrative`Active health insurance policy of ${patientName}, paid by ${insurerName}. Policy commitment ${s.policyCommitment}.`, {
    // The policy's only public identity is its on-chain commitment.
    identifier: [{ system: `${SID}policy-commitment`, value: s.policyCommitment }],
    status: 'active',
    type: concept(`${HL7}v3-ActCode`, 'HIP', 'health insurance plan policy'),
    beneficiary: ref(patient),
    payor: [ref(insurer)],
  });
  // The contract pays exactly the claimed amount, so the benefit equals the submitted amount.
  const amounts = () => [
    { category: concept(`${HL7}adjudication`, 'submitted', 'Submitted Amount'), amount: inr() },
    { category: concept(`${HL7}adjudication`, 'benefit', 'Benefit Amount'), amount: inr() },
  ];
  const note = `Ledger payout: ${s.amount} NIGHT base units (1 NIGHT = 1000000 units). The INR amounts are a separate synthetic business value, not a conversion; no rupees moved.`;
  const summary = narrative`Claim settled on ${at.slice(0, 10)}, outcome complete. Submitted, benefit and payment amounts: INR ${input.amount.value}. Settlement nullifier ${s.nullifier}. ${note}`;
  const response = make('ClaimResponse', summary, {
    // The nullifier is the settlement's on-chain key.
    identifier: [{ system: `${SID}claim-nullifier`, value: s.nullifier }],
    status: 'active',
    // NHCX's SNOMED CT claim type, plus the base FHIR code the sealed record's Claim uses.
    type: {
      coding: [
        OUTPATIENT.has(c.procedure.code)
          ? { system: SNOMED, code: '737492002', display: 'Outpatient care management (procedure)' }
          : { system: SNOMED, code: '737481003', display: 'Inpatient care management (procedure)' },
        { system: `${HL7}claim-type`, code: 'institutional', display: 'Institutional' },
      ],
    },
    use: 'claim',
    patient: ref(patient),
    created: at,
    insurer: ref(insurer),
    requestor: ref(hospital),
    outcome: 'complete',
    disposition: 'Claim settled: the payer contract verified the claim proof and paid it.',
    // itemSequence 1 is the single item of the hospital's Claim.
    item: [{ itemSequence: 1, adjudication: amounts() }],
    total: amounts(),
    payment: { type: concept(`${HL7}ex-paymenttype`, 'complete', 'Complete'), date: at.slice(0, 10), amount: inr() },
    processNote: [{ number: 1, type: 'display', text: note }],
    insurance: [{ sequence: 1, focal: true, coverage: ref(coverage) }],
  });
  const resources = [response, patient, insurer, hospital, coverage];
  return {
    resourceType: 'Bundle',
    meta: {
      profile: [`${PROFILE}ClaimResponseBundle`],
      // As in the IG's own settlement example.
      security: [{ system: `${HL7}v3-Confidentiality`, code: 'V', display: 'very restricted' }],
    },
    type: 'collection',
    timestamp: at,
    entry: resources.map((resource) => ({ fullUrl: `urn:uuid:${resource.id}`, resource })),
  };
}
