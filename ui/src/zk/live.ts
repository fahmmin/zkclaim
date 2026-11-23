// Live mode: the same flows as demo mode, through the 1AM wallet on a real Midnight network, with sealed cards
// and records on IPFS. Every role's zkClaim identity lives in this browser; the wallet proves, pays fees and
// submits, so each action is one 1AM approval.
import { deployContract, submitCallTx } from '@midnight-ntwrk/midnight-js-contracts';
import { ContractState } from '@midnight-ntwrk/midnight-js-protocol/v9/compact-runtime';
import { MidnightBech32m, UnshieldedAddress } from '@midnightntwrk/wallet-sdk-address-format';
import { type Actor, type Ledger, ledger as decodeLedger } from '@zkclaim/contract';
import { type BlobStore, type EncIdentity, fromBase64Url, kuboStore, memoryStore, newEncIdentity, parse, stringify, toBase64Url } from '@zkclaim/records';
import { type Balances, CompiledZkClaim, connectWallet, DEFAULT_NETWORK_ID, readBalances, type Wallet } from '../midnight';
import { type Cast, CAST, type Chain, DemoService, type Made, personFrom } from './demo';
import { type LiveInfo, type Mode, type PolicyCard, reason, type Snapshot, unhex } from './service';

const CAST_KEY = 'zkclaim-live-cast';
/** Shared with the wallet-check page. */
const CONTRACT_KEY = 'zkclaim-contract';
const stateKey = (address: string) => `zkclaim-live-state:${address}`;
/** asOf runs this far ahead of the clock, so it is not behind the block that finally includes a slow proof. */
const AS_OF_LEAD = 180;

/**
 * 1AM pays fees only from DUST coins it shows as ready under "Your DUST". Spending the NIGHT behind its DUST (funding
 * the pool does) leaves it with none for a while, and it answers "Wallet DUST state is not ready".
 */
const NO_READY_DUST = /DUST state is not ready/i;
const dustHelp = (e: unknown) =>
  NO_READY_DUST.test(reason(e))
    ? new Error(
        "1AM has no DUST coin ready to pay the fee (see Your DUST in 1AM: maturing, 0 ready). Funding the pool spends the NIGHT behind 1AM's DUST, so fund it before you film, or from another wallet, and try again once 1AM shows a ready coin.",
      )
    : e;

/**
 * 1AM takes one transaction at a time: until its previous one confirms, it refuses the next before signing anything
 * ("A transaction is already pending"). Nothing was spent, so send it again every 5 s, for up to three minutes.
 */
async function oneAtATime<T>(send: () => Promise<T>): Promise<T> {
  const giveUp = Date.now() + 180_000;
  for (;;) {
    try {
      return await send();
    } catch (e) {
      if (!/already pending/i.test(reason(e))) throw e;
      if (Date.now() > giveUp) throw new Error("1AM is still confirming its previous transaction and won't take another yet. Try again in a minute.");
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}

/**
 * Where sealed cards and records go when no IPFS node is reachable (the hosted site: Kubo only allows localhost:5173).
 * Same CIDs as memoryStore; the bytes live in this browser, so a reload or a crash doesn't lose them.
 */
export function browserStore(): BlobStore {
  const mem = memoryStore();
  const key = (cid: string) => `zkclaim-blob:${cid}`;
  return {
    async put(data) {
      const cid = await mem.put(data);
      localStorage.setItem(key(cid), toBase64Url(data));
      return cid;
    },
    async get(cid) {
      const saved = localStorage.getItem(key(cid));
      return saved === null ? mem.get(cid) : fromBase64Url(saved);
    },
  };
}

/** Private state is per identity; Midnight.js keys it by a short id. */
const stateId = (who: Actor) => `zk-${who.coin.slice(0, 20)}`;

class WalletChain implements Chain {
  now = 0; // a real chain keeps its own time
  ledger!: Ledger;

  constructor(
    readonly address: string,
    private readonly wallet: Wallet,
  ) {}

  async refresh() {
    const read = await this.wallet.providers.publicDataProvider.queryContractState(this.address);
    if (!read) throw new Error(`There is no contract at ${this.address} on this network`);
    if (read.contractState.era !== 'v9') throw new Error('Expected a ledger 9 contract');
    this.ledger = decodeLedger(read.contractState.deserialize({ v9: ContractState }).data);
  }

  call = (async (who: Actor, circuitId: string, ...args: unknown[]) => {
    await this.wallet.providers.privateStateProvider.forContract(this.address).set(stateId(who), who.privateState);
    const res = await oneAtATime(() =>
      submitCallTx(this.wallet.providers, {
        compiledContract: CompiledZkClaim,
        contractAddress: this.address,
        privateStateId: stateId(who),
        circuitId,
        args,
      } as never),
    ).catch((e) => {
      throw dustHelp(e);
    });
    await this.refresh();
    return (res as { private: { result: unknown } }).private.result;
  }) as unknown as Chain['call'];
}

type SavedCast = { people: { id: string; sk: Uint8Array; enc: EncIdentity }[]; emergency: EncIdentity };

export class LiveService extends DemoService {
  override readonly mode: Mode = 'live';
  protected override network = DEFAULT_NETWORK_ID;
  private wallet: Wallet | null = null;
  private balances: Balances | null = null;
  private ipfs: LiveInfo['ipfs'] = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super(false);
    this.emit(); // the base constructor built the first snapshot before these fields existed
  }

  protected override asOf() {
    return this.now() + AS_OF_LEAD;
  }

  protected override build(): Snapshot {
    return {
      ...super.build(),
      live: {
        networkId: this.network,
        wallet: this.wallet?.name ?? null,
        address: this.balances?.unshieldedAddress ?? null,
        night: this.balances?.night ?? 0n,
        dust: this.balances?.dust ?? 0n,
        ipfs: this.ipfs ?? null,
        savedContract: localStorage.getItem(CONTRACT_KEY),
      },
    };
  }

  private need(): Wallet {
    if (!this.wallet) throw new Error('Connect the 1AM wallet first');
    return this.wallet;
  }

  connect(networkId = DEFAULT_NETWORK_ID) {
    return this.run('Connect 1AM', async () => {
      this.network = networkId;
      this.wallet = await connectWallet(networkId);
      this.balances = await readBalances(this.wallet.api);
      // Kubo when it is up (npm run env:up starts it), else this browser's storage.
      const kubo = kuboStore();
      this.ipfs = await kubo.put(new TextEncoder().encode('zkclaim')).then(
        () => 'kubo' as const,
        () => 'browser' as const,
      );
      this.store = this.ipfs === 'kubo' ? kubo : browserStore();
    });
  }

  refreshBalances() {
    return this.run('Refresh balances', async () => {
      this.balances = await readBalances(this.need().api);
    });
  }

  /** Deploys a fresh contract: this browser's insurer identity becomes the insurer. */
  deploy() {
    return this.reset();
  }

  join(address: string) {
    return this.run('Join contract', async () => {
      const a = address.trim().replace(/^0x/i, '').toLowerCase();
      if (!/^[0-9a-f]{64}$/.test(a)) throw new Error('A contract address is 64 hex characters');
      this.adopt(await this.newCast());
      const chain = new WalletChain(a, this.need());
      await chain.refresh();
      this.sim = chain;
      this.forget();
      this.restore(a);
      localStorage.setItem(CONTRACT_KEY, a);
      this.watch();
    });
  }

  leave() {
    localStorage.removeItem(CONTRACT_KEY);
    this.sim = null;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.emit();
  }

  /** The same identities every time this browser comes back; hospitals are paid to the connected wallet. */
  protected override async newCast(): Promise<Cast> {
    let saved: SavedCast | null = null;
    try {
      saved = parse<SavedCast>(localStorage.getItem(CAST_KEY) ?? 'null');
    } catch {
      saved = null;
    }
    if (!saved || CAST.some(([id]) => !saved!.people.some((p) => p.id === id))) {
      const fresh = await Promise.all(CAST.map(async ([id]) => ({ id, sk: crypto.getRandomValues(new Uint8Array(32)), enc: await newEncIdentity() })));
      saved = { people: fresh, emergency: await newEncIdentity() };
      localStorage.setItem(CAST_KEY, stringify(saved));
    }
    const payTo = this.payoutAddress();
    const people = CAST.map(([id, name, note]) => {
      const p = saved!.people.find((x) => x.id === id)!;
      return personFrom(id, name, note, p.sk, p.enc, payTo);
    });
    return { people, emergency: saved.emergency };
  }

  /** The connected wallet's unshielded address as the 32 bytes a UserAddress holds. */
  private payoutAddress(): Uint8Array {
    const bech32 = this.balances?.unshieldedAddress;
    if (!bech32) throw new Error('Connect the 1AM wallet first');
    return new Uint8Array(MidnightBech32m.parse(bech32).decode(UnshieldedAddress, this.network).data);
  }

  protected override async newChain(cast: Cast): Promise<Chain> {
    const wallet = this.need();
    const deployed = await oneAtATime(() =>
      deployContract(wallet.providers, {
        compiledContract: CompiledZkClaim,
        privateStateId: stateId(this.insurer.actor),
        initialPrivateState: this.insurer.actor.privateState,
        args: [unhex(this.insurer.pk), new Uint8Array(cast.emergency.publicKey)],
      } as never),
    ).catch((e) => {
      throw dustHelp(e);
    });
    const address = (deployed as { deployTxData: { public: { contractAddress: string } } }).deployTxData.public.contractAddress;
    localStorage.setItem(CONTRACT_KEY, address);
    const chain = new WalletChain(address, wallet);
    await chain.refresh();
    queueMicrotask(() => this.watch());
    return chain;
  }

  protected override async reread() {
    await new Promise((r) => setTimeout(r, 2000));
    if (this.sim instanceof WalletChain) await this.sim.refresh();
  }

  override skipAhead() {
    // A real chain keeps its own time.
  }

  /** Picks up what other devices do (a patient phone, another desk) between our own transactions. */
  private watch() {
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(async () => {
      if (this.busy || !(this.sim instanceof WalletChain)) return;
      try {
        await this.sim.refresh();
        await this.scanPhone();
        this.emit();
      } catch (e) {
        console.warn('[live] refresh failed', e);
      }
    }, 8000);
  }

  // What this browser knows besides the chain (hospital records, issued cards, claim metadata), per contract.
  protected override emit() {
    super.emit();
    const address = this.sim?.address;
    if (!address) return;
    try {
      localStorage.setItem(
        stateKey(address),
        stringify({
          leafOf: [...this.leafOf],
          funded: this.funded,
          book: this.book,
          made: this.made,
          claimMeta: [...this.claimMeta],
          reasons: [...this.reasons],
          withdrawn: [...this.withdrawn],
          desk: this.desk,
        }),
      );
    } catch (e) {
      console.warn('[live] could not save local state', e);
    }
  }

  private restore(address: string) {
    const raw = localStorage.getItem(stateKey(address));
    if (!raw) return;
    try {
      const s = parse<{
        leafOf: [string, number][];
        funded: bigint;
        book: PolicyCard[];
        made: Made[];
        claimMeta: [string, { recordId: string; hospitalId: string; root: string; payTo: string }][];
        reasons: [string, string][];
        withdrawn?: string[]; // absent in state saved before withdrawal existed
        desk: string;
      }>(raw);
      this.leafOf = new Map(s.leafOf);
      this.funded = s.funded;
      this.book = s.book;
      this.made = s.made;
      this.claimMeta = new Map(s.claimMeta);
      this.reasons = new Map(s.reasons);
      this.withdrawn = new Set(s.withdrawn ?? []);
      this.desk = s.desk;
    } catch (e) {
      console.warn('[live] ignoring unreadable saved state', e);
    }
  }
}
