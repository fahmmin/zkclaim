import type { WitnessContext } from '@midnight-ntwrk/compact-runtime';
import type { Ledger, PolicyTerms, TreatmentRecord, Witnesses } from './managed/zkclaim/contract/index.js';

/**
 * Everything here stays on the caller's device. The insurer only needs `secretKey`; a hospital
 * holds the record it is claiming plus the policy card the patient showed it; a patient holds
 * their policy and the record they are consenting to.
 */
export type ClaimPrivateState = {
  readonly secretKey: Uint8Array;
  readonly policy: { readonly terms: PolicyTerms; readonly salt: Uint8Array } | null;
  readonly record: { readonly record: TreatmentRecord; readonly salt: Uint8Array } | null;
};

export const createPrivateState = (
  secretKey: Uint8Array,
  policy: ClaimPrivateState['policy'] = null,
  record: ClaimPrivateState['record'] = null,
): ClaimPrivateState => ({ secretKey, policy, record });

type Ctx = WitnessContext<Ledger, ClaimPrivateState>;

const need = <T>(value: T | null, what: string): T => {
  if (value === null) throw new Error(`No ${what} in private state`);
  return value;
};

// A leaf that is not in the tree still gets a (wrong) all-zero path, so the circuit itself rejects
// it with its own message instead of the witness throwing.
const pathOrDummy = (tree: Ledger['hospitals'], leaf: Uint8Array, depth: number) =>
  tree.findPathForLeaf(leaf) ?? { leaf, path: Array.from({ length: depth }, () => ({ sibling: { field: 0n }, goes_left: false })) };

export const witnesses: Witnesses<ClaimPrivateState> = {
  secretKey: ({ privateState }: Ctx) => [privateState, privateState.secretKey],
  policyTerms: ({ privateState }: Ctx) => [privateState, need(privateState.policy, 'policy').terms],
  policySalt: ({ privateState }: Ctx) => [privateState, need(privateState.policy, 'policy').salt],
  treatmentRecord: ({ privateState }: Ctx) => [privateState, need(privateState.record, 'treatment record').record],
  recordSalt: ({ privateState }: Ctx) => [privateState, need(privateState.record, 'treatment record').salt],
  hospitalPath: ({ privateState, ledger }: Ctx, pk: Uint8Array) => [privateState, pathOrDummy(ledger.hospitals, pk, 10)],
  recordPath: ({ privateState, ledger }: Ctx, c: Uint8Array) => [privateState, pathOrDummy(ledger.records, c, 16)],
};
