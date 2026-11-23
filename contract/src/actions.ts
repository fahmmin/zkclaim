// The contract merges related actions into shared circuits so its deploy fits in a block (each circuit adds
// ~2.7 KB). These map the actions apps think in to the circuit and arguments that run them:
//   const { circuitId, args } = actions.addHospital(pk);  // -> submitCallTx({ circuitId, args, ... })
import type { ImpureCircuits } from './managed/zkclaim/contract/index.js';

const ZERO = new Uint8Array(32);
type Call = { circuitId: keyof ImpureCircuits<unknown>; args: unknown[] };

export const actions = {
  addHospital: (pk: Uint8Array): Call => ({ circuitId: 'admin', args: [1n, pk, 0n, ZERO, ''] }),
  removeHospital: (index: bigint): Call => ({ circuitId: 'admin', args: [2n, ZERO, index, ZERO, ''] }),
  issuePolicy: (commitment: Uint8Array, cid: string): Call => ({ circuitId: 'admin', args: [3n, ZERO, 0n, commitment, cid] }),
  setResponder: (pk: Uint8Array, approved: boolean): Call => ({ circuitId: 'admin', args: [approved ? 4n : 5n, pk, 0n, ZERO, ''] }),
  grantAccess: (grantee: Uint8Array, role: bigint, expiresAt: bigint, wrappedKey: string, asOf: bigint): Call => ({
    circuitId: 'setAccess',
    args: [grantee, role, expiresAt, wrappedKey, '', asOf],
  }),
  revokeAccess: (grantee: Uint8Array, newCid: string, asOf: bigint): Call => ({ circuitId: 'setAccess', args: [grantee, 0n, 0n, '', newCid, asOf] }),
  // Same name as the circuit, so `call(patient, 'consentToClaim')` still consents.
  consentToClaim: (withdraw = false): Call => ({ circuitId: 'consentToClaim', args: [withdraw] }),
  withdrawConsent: (): Call => ({ circuitId: 'consentToClaim', args: [true] }),
};

export type ActionName = keyof typeof actions;

/** A plain view; any non-zero `reason` passed to `logView` is break-glass. */
export const NO_REASON = ZERO;
