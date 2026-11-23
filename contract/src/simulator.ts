import {
  type CircuitContext,
  createCircuitContext,
  createConstructorContext,
  sampleContractAddress,
} from '@midnight-ntwrk/compact-runtime';
import { Contract, type ImpureCircuits, ledger, pureCircuits } from './managed/zkclaim/contract/index.js';
import { type ClaimPrivateState, createPrivateState, witnesses } from './witnesses.js';

export const bytes32 = (n: number): Uint8Array => {
  const a = new Uint8Array(32);
  a[31] = n;
  return a;
};

/** One party: its own wallet key and its own private state, as on separate devices. */
export type Actor = { coin: string; privateState: ClaimPrivateState };

export const actor = (n: number): Actor => ({
  coin: n.toString(16).padStart(64, '0'),
  privateState: createPrivateState(bytes32(100 + n)),
});

export const pkOf = (a: Actor): Uint8Array => pureCircuits.publicKey(a.privateState.secretKey);

type PS = ClaimPrivateState;
type Args<F> = F extends (ctx: CircuitContext<PS>, ...args: infer A) => unknown ? A : never;
type Result<F> = F extends (...args: never[]) => Promise<{ result: infer R }> ? R : never;

/** Token movements of the last successful call, read from the circuit's effects. */
export type Transfers = { received: bigint; paid: bigint };

/**
 * Runs the compiled contract's real circuit logic (the same code the proof server proves) against
 * an in-memory ledger: one shared public state, one private state per actor.
 */
export class ClaimSimulator {
  readonly address = sampleContractAddress();
  private state!: CircuitContext<PS>['callContext']['currentQueryContext']['state'];
  /** Block time in unix seconds. */
  now = 1_800_000_000;
  lastTransfers: Transfers = { received: 0n, paid: 0n };

  private constructor(readonly contract: Contract<PS>) {}

  /** `w` lets a test swap in a dishonest witness, the way a malicious prover would. */
  static async create(insurer: Actor, w: typeof witnesses = witnesses): Promise<ClaimSimulator> {
    const sim = new ClaimSimulator(new Contract<PS>(w));
    const init = await sim.contract.initialState(createConstructorContext(insurer.privateState, insurer.coin), pkOf(insurer));
    sim.state = init.currentContractState.data;
    return sim;
  }

  get ledger() {
    return ledger(this.state);
  }

  /** Debug rendering of the entire public contract state. */
  publicStateText(): string {
    return this.state.toString(false);
  }

  /** Run `id` as `who`; on success commit the public state and that actor's private state. */
  async call<K extends keyof ImpureCircuits<PS>>(who: Actor, id: K, ...args: Args<ImpureCircuits<PS>[K]>): Promise<Result<ImpureCircuits<PS>[K]>> {
    const ctx = createCircuitContext({
      circuitId: id,
      contractAddress: this.address,
      coinPublicKeyOrZswapState: who.coin,
      contractState: this.state,
      privateState: who.privateState,
      time: this.now,
    });
    const circuit = this.contract.impureCircuits[id] as (ctx: CircuitContext<PS>, ...a: unknown[]) => Promise<{ result: unknown; context: CircuitContext<PS> }>;
    const { result, context } = await circuit(ctx, ...args);
    const effects = context.callContext.currentQueryContext.effects;
    const sum = (m: Map<unknown, bigint>) => [...m.values()].reduce((a, b) => a + b, 0n);
    this.lastTransfers = { received: sum(effects.unshieldedInputs), paid: sum(effects.claimedUnshieldedSpends) };
    this.state = context.callContext.currentQueryContext.state;
    who.privateState = context.callContext.currentPrivateState ?? who.privateState;
    return result as Result<ImpureCircuits<PS>[K]>;
  }
}
