// Demo mode: every role lives in this tab and talks to one in-browser ClaimSimulator, which runs the compiled
// contract's real circuit logic (the code the proof server proves), with records sealed by @zkclaim/records into
// an in-memory IPFS store. No wallet, instant, same rejections as the chain.
import { type Actor, actions, AuditKind, ClaimSimulator, createPrivateState, type Ledger, NO_REASON, type PolicyTerms, pureCircuits, type TreatmentRecord, witnesses } from '@zkclaim/contract';
import {
  type BlobStore,
  buildBundle,
  cardCode,
  type ClaimData,
  contentHash,
  type EncIdentity,
  getJson,
  grantKeyFor,
  memoryStore,
  newEncIdentity,
  openCard,
  openRecord,
  type PolicyCard as LibCard,
  putJson,
  readCardCode,
  resealRecord,
  ROLE_CODES,
  SAMPLE_CASES,
  type SealedRecord,
  sealCard,
  sealRecord,
  type SectionKeys,
  sectionKeysFor,
  sectionsOf,
  unwrapGrant,
} from '@zkclaim/records';
import {
  type AccessRole,
  type Admission,
  type AuditEntry,
  type Claim,
  COSMETIC,
  describe,
  fingerprint,
  type Grant,
  type GranteeRole,
  headline,
  hex,
  type IssueInput,
  type MedicalRecord,
  type Mode,
  type OpenedRecord,
  type PolicyCard,
  PROCEDURES,
  procedureName,
  reason,
  type RecordSections,
  ROLE_TITLES,
  type SectionName,
  type Snapshot,
  short,
  type TreatmentInput,
  unhex,
  type ZkClaimService,
} from './service';

const rand32 = () => crypto.getRandomValues(new Uint8Array(32));
const sha256 = async (text: string) => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
const NIGHT = 1_000_000n;
const ROLE_BY_CODE: Record<number, AccessRole> = { 1: 'doctor', 2: 'lab', 3: 'pharmacy', 4: 'emergency' };

/** Audit entries in the order they were written (the ledger map does not iterate in key order). */
const auditLog = (l: Ledger) => [...l.audit].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, e]) => e);

const span = (seconds: number) =>
  seconds >= 86_400 ? `${Math.round(seconds / 86_400)} day${seconds >= 172_800 ? 's' : ''}` : seconds >= 3600 ? `${Math.round(seconds / 3600)} h` : `${Math.round(seconds / 60)} min`;

export type Person = { id: string; name: string; note: string; actor: Actor; pk: string; enc: EncIdentity; payTo: Uint8Array };

/** What the service needs from a chain: the in-browser ClaimSimulator, or the 1AM wallet on a real network. */
export interface Chain {
  readonly address: string;
  readonly ledger: Ledger;
  /** Block clock in unix seconds; the simulator follows the demo clock, a real chain ignores it. */
  now: number;
  call: ClaimSimulator['call'];
}

/** Builds a person from their keys: fresh keys in demo mode, remembered ones in live mode. */
export function personFrom(id: string, name: string, note: string, sk: Uint8Array, enc: EncIdentity, payTo: Uint8Array): Person {
  const pk = hex(pureCircuits.publicKey(sk));
  return { id, name, note, actor: { coin: pk, privateState: createPrivateState(sk) }, pk, enc, payTo };
}

/** The fictional cast: one identity per party, all in this browser. */
export const CAST: [id: string, name: string, note: string][] = [
  ['insurer', 'Kestrel Mutual', 'Claims desk'],
  ['juniper', 'St. Juniper General', 'Partner hospital'],
  ['harbour', 'Harbourview Clinic', 'Partner clinic'],
  ['quickfix', 'Quickfix Clinic', 'No licence on file'],
  ['patient', 'Rohan Iyer', ''],
  ['doctor', 'Dr. Ishaan Mehta', ''],
  ['lab', 'Lumen Diagnostics', ''],
  ['pharmacy', 'Corner Leaf Pharmacy', ''],
  ['unit7', 'Paramedic Tara Joseph', 'Ambulance unit 7'],
  ['volunteer', 'Off-duty volunteer', 'Not on the responder list'],
];

export type Cast = { people: Person[]; emergency: EncIdentity };

async function freshCast(): Promise<Cast> {
  const people = await Promise.all(CAST.map(async ([id, name, note]) => personFrom(id, name, note, rand32(), await newEncIdentity(), rand32())));
  return { people, emergency: await newEncIdentity() };
}

/** The UI's view of a card from @zkclaim/records; the fingerprint is recomputed, never taken on trust. */
export function uiCard(card: LibCard): PolicyCard {
  const fp = hex(pureCircuits.policyCommitment(card.terms, card.salt));
  return {
    policyNo: `KM-${fp.slice(0, 6).toUpperCase()}`,
    holderName: card.holderName,
    holderPk: hex(card.terms.holderPk),
    insurer: card.insurer,
    plan: card.plan,
    limit: card.terms.limit,
    expiresAt: Number(card.terms.expiresAt),
    covered: card.terms.covered.filter((c) => c !== 0n).map(Number),
    fingerprint: fp,
    issuedAt: card.issuedAt,
    code: cardCode(card),
  };
}

/** A record as the treating hospital keeps it: the claim data plus the card it admitted. */
export type Made = {
  id: string;
  claim: ClaimData;
  policy: { terms: PolicyTerms; salt: Uint8Array };
  hospitalId: string;
  createdAt: number;
  patientName: string;
  sections: RecordSections;
};

/** A record the patient's phone found on-chain and decrypted with its own key. */
type Opened = { id: string; cid: string; sealed: SealedRecord; keys: SectionKeys; claim: ClaimData };

export class DemoService implements ZkClaimService {
  readonly mode: Mode = 'demo';
  protected network = 'in-browser simulator';
  private listeners = new Set<() => void>();
  private snap!: Snapshot;
  protected sim: Chain | null = null;
  protected store: BlobStore = memoryStore();
  protected skew = 0;
  protected busy: string | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  protected insurer!: Person;
  protected hospitals: Person[] = [];
  protected patient!: Person;
  protected care!: Record<GranteeRole, Person>;
  protected responders: Person[] = [];
  protected emergency!: EncIdentity;
  private names = new Map<string, { name: string; role?: AccessRole }>();

  // What this browser knows besides the chain (live mode saves it per contract).
  protected leafOf = new Map<string, number>();
  protected funded = 0n;
  protected book: PolicyCard[] = [];
  protected made: Made[] = [];
  protected claimMeta = new Map<string, { recordId: string; hospitalId: string; root: string; payTo: string }>();
  protected reasons = new Map<string, string>();
  protected withdrawn = new Set<string>(); // records whose consent the patient took back on this device
  protected desk = 'juniper';
  // The patient's phone: what it decrypted from the chain, cached per CID (null = not addressed to them).
  private cards = new Map<string, LibCard | null>();
  private opened = new Map<string, Opened | null>();

  constructor(start = true) {
    this.snap = this.build();
    if (start) void this.reset();
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  };

  snapshot = () => this.snap;

  /** The caller's clock, for display and expiry. */
  protected now() {
    return Math.floor(Date.now() / 1000) + this.skew;
  }

  /** The `asOf` passed to circuits: it must not be behind the block that includes the transaction. */
  protected asOf() {
    return this.now();
  }

  protected emit() {
    this.snap = this.build();
    for (const fn of this.listeners) fn();
  }

  /** The chain with its block clock set to now (the demo clock, including any skip-ahead). */
  private chain(): Chain {
    if (!this.sim) throw new Error('The chain is not ready yet');
    this.sim.now = this.now();
    return this.sim;
  }

  private get ledger(): Ledger {
    return this.chain().ledger;
  }

  /** Runs one of the contract's named actions (`actions` maps them onto its shared circuits) as `who`. */
  private act(who: Actor, { circuitId, args }: { circuitId: string; args: unknown[] }) {
    return (this.chain().call as (who: Actor, id: string, ...a: unknown[]) => Promise<unknown>)(who, circuitId, ...args);
  }

  /** One operation at a time, like transactions; errors come back as the contract's own message. */
  protected run<T>(label: string, task: () => Promise<T>): Promise<T> {
    const next = this.queue.then(async () => {
      this.busy = label;
      this.emit();
      try {
        return await task();
      } catch (e) {
        console.info(`[${this.mode}] ${label} rejected:`, reason(e));
        throw new Error(reason(e));
      } finally {
        await this.scanPhone().catch((e) => console.error(`[${this.mode}] patient scan failed`, e));
        this.busy = null;
        this.emit();
      }
    });
    this.queue = next.catch(() => undefined);
    return next;
  }

  private hospital = (id: string) => {
    const h = this.hospitals.find((x) => x.id === id);
    if (!h) throw new Error(`Unknown hospital ${id}`);
    return h;
  };

  private madeRecord = (id: string) => {
    const r = this.made.find((x) => x.id === id);
    if (!r) throw new Error('Unknown record');
    return r;
  };

  private mine = (id: string) => {
    const o = [...this.opened.values()].find((x) => x?.id === id);
    if (!o) throw new Error("This record isn't on the patient's phone");
    return o;
  };

  /** A public network's indexer can trail a just-confirmed transaction: re-read until `seen()` holds (about a minute). */
  protected async caughtUp(seen: () => boolean) {
    for (let i = 0; i < 30 && !seen(); i++) await this.reread();
  }

  /** Re-reads the public state; the in-browser simulator is always current. */
  protected async reread() {}

  /** The X25519 key `pk` published on-chain; our own cast publishes theirs on first use. */
  private async encKey(pk: string | Uint8Array, who: string): Promise<Uint8Array> {
    const id = typeof pk === 'string' ? unhex(pk) : pk;
    if (!this.ledger.encKeys.member(id)) {
      const p = this.everyone().find((x) => x.pk === hex(id));
      if (!p) throw new Error(`${who} has no encryption key on-chain yet`);
      await this.chain().call(p.actor, 'registerEncKey', p.enc.publicKey);
      await this.caughtUp(() => this.ledger.encKeys.member(id));
    }
    return this.ledger.encKeys.lookup(id);
  }

  protected everyone = (): Person[] => [this.insurer, ...this.hospitals, this.patient, ...Object.values(this.care ?? {}), ...this.responders].filter(Boolean);

  private emergencyKeyOnChain(): Uint8Array {
    const k = this.ledger.emergencyKey;
    if (k.every((b) => b === 0)) throw new Error('This contract was deployed without an emergency key, so records cannot be sealed for responders');
    return k;
  }

  /** The patient's phone scans policyCids and recordCids and keeps whatever opens with its key. */
  protected async scanPhone() {
    if (!this.sim) return;
    const l = this.sim.ledger;
    // Per item: a blob this device can't fetch (yet) is retried next scan; one that won't open is not ours.
    for (const [, cid] of l.policyCids) {
      if (this.cards.has(cid)) continue;
      const sealed = await getJson<string>(this.store, cid).catch(() => null);
      if (sealed === null) continue;
      this.cards.set(cid, await openCard(sealed, this.patient.enc).catch(() => null));
    }
    for (const [c, cid] of l.recordCids) {
      if (this.opened.has(cid)) continue;
      const sealed = await getJson<SealedRecord>(this.store, cid).catch(() => null);
      if (sealed === null) continue;
      try {
        const keys = await sectionKeysFor(sealed, 'owner', this.patient.enc);
        const { claimData } = await openRecord(sealed, keys);
        this.opened.set(cid, { id: hex(c), cid, sealed, keys, claim: claimData! });
      } catch {
        this.opened.set(cid, null);
      }
    }
  }

  private walletCard(): LibCard | null {
    return [...this.cards.values()].filter((c): c is LibCard => !!c).sort((a, b) => b.issuedAt - a.issuedAt)[0] ?? null;
  }

  private view(m: Made, l: Ledger | undefined, mine: Set<string>): MedicalRecord {
    const recordC = pureCircuits.recordCommitment(m.claim.record, m.claim.salt);
    const policyC = pureCircuits.policyCommitment(m.policy.terms, m.policy.salt);
    const paid = l?.claims.member(pureCircuits.claimNullifier(recordC, m.claim.salt));
    const consented = l?.consents.member(pureCircuits.consentTag(recordC, policyC, m.claim.salt));
    const code = Number(m.claim.record.procedureCode);
    return {
      id: m.id,
      cid: l?.recordCids.member(recordC) ? l.recordCids.lookup(recordC) : '',
      patientName: m.patientName,
      hospitalId: m.hospitalId,
      hospitalName: this.hospital(m.hospitalId).name,
      createdAt: m.createdAt,
      procedure: { code, name: procedureName(code) },
      amount: m.claim.record.amount,
      sections: m.sections,
      status: paid ? 'paid' : consented ? 'consented' : 'anchored',
      mine: mine.has(m.id),
      withdrawn: !paid && !consented && this.withdrawn.has(m.id),
    };
  }

  private nameOf = (pk: string) => this.names.get(pk)?.name ?? `Key ${short(pk, 6, 4)}`;

  private grantsFrom(l: Ledger): Grant[] {
    const out = new Map<string, Grant>();
    for (const e of auditLog(l)) {
      const record = hex(e.record);
      const pk = hex(e.actor);
      const at = Number(e.at);
      const k = record + pk;
      if (e.kind === AuditKind.granted || e.kind === AuditKind.breakGlass) {
        out.delete(k);
        out.set(k, { record, role: this.names.get(pk)?.role ?? 'doctor', grantee: this.nameOf(pk), granteePk: pk, grantedAt: at, expiresAt: null, revokedAt: null });
      } else if (e.kind === AuditKind.revoked) {
        const g = out.get(k);
        if (g) g.revokedAt = at;
      }
    }
    for (const g of out.values()) {
      const key = pureCircuits.grantKey(unhex(g.record), unhex(g.granteePk));
      if (!l.grants.member(key)) continue;
      const live = l.grants.lookup(key);
      g.expiresAt = Number(live.expiresAt);
      g.role = ROLE_BY_CODE[Number(live.role)] ?? g.role;
    }
    return [...out.values()].reverse();
  }

  private auditFrom(l: Ledger, grants: Grant[]): AuditEntry[] {
    const entries: AuditEntry[] = [];
    for (const e of auditLog(l)) {
      const record = hex(e.record);
      const pk = hex(e.actor);
      const role = this.names.get(pk)?.role;
      const g = grants.find((x) => x.record === record && x.granteePk === pk);
      const detail =
        e.kind === AuditKind.granted
          ? `${role ? ROLE_TITLES[role] : 'Grantee'} access${g?.expiresAt && g.expiresAt > Number(e.at) ? ` for ${span(g.expiresAt - Number(e.at))}` : ''}`
          : e.kind === AuditKind.revoked
            ? 'Access removed, record re-encrypted under new keys'
            : e.kind === AuditKind.viewed
              ? `Opened the ${role ? ROLE_TITLES[role].toLowerCase() : ''} part of the record`
              : `"${this.reasons.get(hex(e.detail)) ?? `reason hash ${short(hex(e.detail), 8, 4)}`}"`;
      entries.push({ kind: AuditKind[e.kind] as AuditEntry['kind'], record, actor: this.nameOf(pk), at: Number(e.at), detail });
    }
    return entries.reverse();
  }

  protected build(): Snapshot {
    const l = this.sim?.ledger;
    const mine = new Set([...this.opened.values()].filter((o): o is Opened => !!o).map((o) => o.id));
    const grants = l ? this.grantsFrom(l) : [];
    const root = l ? l.hospitals.root().field.toString(16).padStart(64, '0') : '';
    const wallet = this.walletCard();
    const emergencyKey = l && !l.emergencyKey.every((b) => b === 0) ? hex(l.emergencyKey) : null;
    return {
      mode: this.mode,
      ready: !!this.sim,
      network: this.network,
      contract: this.sim?.address ?? '',
      now: this.now(),
      funded: this.funded,
      paid: l?.totalPaid ?? 0n,
      hospitals: this.hospitals.map((h) => ({
        id: h.id,
        name: h.name,
        pk: h.pk,
        approved: !!l?.hospitals.findPathForLeaf(unhex(h.pk)),
        index: this.leafOf.get(h.id) ?? null,
        note: h.note,
      })),
      hospitalRoot: root,
      desk: this.desk,
      policies: this.book,
      patientName: this.patient?.name ?? '',
      card: wallet ? uiCard(wallet) : null,
      records: this.made.map((m) => this.view(m, l, mine)),
      claims: l
        ? [...l.claims]
            .map(([n, s]) => {
              const meta = this.claimMeta.get(hex(n));
              return { nullifier: hex(n), policy: hex(s.policy), amount: s.amount, at: Number(s.at), hospitalRoot: meta?.root ?? root, payTo: meta?.payTo ?? null, recordId: meta?.recordId ?? null, hospitalId: meta?.hospitalId ?? null };
            })
            .sort((a, b) => b.at - a.at)
        : [],
      grants,
      audit: l ? this.auditFrom(l, grants) : [],
      emergencyKey,
      responders: this.responders.map((r) => ({ id: r.id, name: r.name, pk: r.pk, approved: !!l?.responders.member(unhex(r.pk)) })),
      people: { doctor: this.care?.doctor.name ?? '', lab: this.care?.lab.name ?? '', pharmacy: this.care?.pharmacy.name ?? '', emergency: this.responders[0]?.name ?? '' },
      busy: this.busy,
    };
  }

  // ---------- Insurer ----------

  fundPool(amount: bigint) {
    return this.run('Fund pool', async () => {
      await this.chain().call(this.insurer.actor, 'fundPool', amount);
      this.funded += amount;
    });
  }

  approveHospital(id: string) {
    return this.run('Approve hospital', async () => {
      const h = this.hospital(id);
      const index = Number(this.ledger.hospitals.firstFree());
      await this.act(this.insurer.actor, actions.addHospital(unhex(h.pk)));
      this.leafOf.set(id, index);
    });
  }

  removeHospital(id: string) {
    return this.run('Remove hospital', async () => {
      const index = this.leafOf.get(id);
      if (index === undefined) throw new Error('That hospital is not on the list');
      await this.act(this.insurer.actor, actions.removeHospital(BigInt(index)));
      this.leafOf.delete(id);
    });
  }

  issuePolicy(input: IssueInput) {
    return this.run('Issue policy', async () => {
      if (input.covered.length === 0 || input.covered.length > 8) throw new Error('Pick between 1 and 8 covered procedures');
      const holderPk = unhex(this.patient.pk);
      const sealTo = await this.encKey(holderPk, 'The patient');
      const now = this.now();
      const terms: PolicyTerms = {
        holderPk,
        limit: input.limit,
        expiresAt: BigInt(now + input.validDays * 86_400),
        covered: [...input.covered.map(BigInt), 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n].slice(0, 8),
      };
      const salt = rand32();
      const policyId = hex(pureCircuits.policyCommitment(terms, salt));
      const card: LibCard = { terms, salt, holderName: input.holderName.trim() || this.patient.name, insurer: this.insurer.name, plan: input.plan, issuedAt: now, policyId };
      const cid = await putJson(this.store, await sealCard(card, sealTo));
      await this.act(this.insurer.actor, actions.issuePolicy(unhex(policyId), cid));
      const ui = uiCard(card);
      this.book = [ui, ...this.book];
      return ui;
    });
  }

  setResponder(id: string, approved: boolean) {
    return this.run(approved ? 'Approve responder' : 'Remove responder', async () => {
      const r = this.responders.find((x) => x.id === id);
      if (!r) throw new Error('Unknown responder');
      await this.act(this.insurer.actor, actions.setResponder(unhex(r.pk), approved));
    });
  }

  // ---------- Hospital ----------

  setDesk(id: string) {
    this.hospital(id);
    this.desk = id;
    this.emit();
  }

  admit(code: string) {
    return this.run('Admit patient', async (): Promise<Admission> => {
      const card = readCardCode(code);
      const c = pureCircuits.policyCommitment(card.terms, card.salt);
      // readCardCode only checks the shape; a card whose terms were edited no longer matches its fingerprint.
      if (hex(c) !== card.policyId) throw new Error("This card's terms don't match its fingerprint. It was altered after it was issued.");
      const l = this.ledger;
      return { card: uiCard(card), onChain: l.policies.member(c), expired: Number(card.terms.expiresAt) <= this.now(), spent: l.spent.member(c) ? l.spent.lookup(c) : 0n };
    });
  }

  createRecord(card: PolicyCard, input: TreatmentInput) {
    return this.run('Seal & anchor record', async () => {
      const h = this.hospital(this.desk);
      const lib = readCardCode(card.code);
      const bundle = buildBundle(input);
      const record: TreatmentRecord = {
        patientPk: lib.terms.holderPk,
        hospitalPk: unhex(h.pk),
        procedureCode: BigInt(input.procedure.code),
        amount: input.amount,
        contentHash: await contentHash(bundle),
      };
      const claim: ClaimData = { record, salt: rand32() };
      const recipients = { owner: await this.encKey(lib.terms.holderPk, 'The patient'), hospital: await this.encKey(h.pk, h.name), emergency: this.emergencyKeyOnChain() };
      const { sealed } = await sealRecord(bundle, claim, recipients);
      const cid = await putJson(this.store, sealed);
      const id = hex(pureCircuits.recordCommitment(record, claim.salt));
      await this.chain().call(h.actor, 'anchorRecord', unhex(id), cid);
      const m: Made = { id, claim, policy: { terms: lib.terms, salt: lib.salt }, hospitalId: h.id, createdAt: this.now(), patientName: lib.holderName, sections: describe(sectionsOf(bundle)) };
      this.made = [m, ...this.made];
      return this.view(m, this.ledger, new Set());
    });
  }

  submitClaim(recordId: string) {
    return this.run('Prove & submit claim', async () => {
      const h = this.hospital(this.desk);
      const m = this.madeRecord(recordId);
      h.actor.privateState = createPrivateState(h.actor.privateState.secretKey, m.policy, m.claim);
      const sim = this.chain();
      const n = hex(await sim.call(h.actor, 'submitClaim', m.claim.record.amount, BigInt(this.asOf()), { bytes: h.payTo }));
      await this.caughtUp(() => sim.ledger.claims.member(unhex(n)));
      const root = sim.ledger.hospitals.root().field.toString(16).padStart(64, '0');
      this.claimMeta.set(n, { recordId, hospitalId: h.id, root, payTo: hex(h.payTo) });
      const s = sim.ledger.claims.lookup(unhex(n));
      return { nullifier: n, policy: hex(s.policy), amount: s.amount, at: Number(s.at), hospitalRoot: root, payTo: hex(h.payTo), recordId, hospitalId: h.id };
    });
  }

  // ---------- Patient ----------

  /** Puts the record and the phone's card in the patient's private state; returns the consent tag that pair makes. */
  private asPatientFor(recordId: string) {
    const o = this.mine(recordId);
    const card = this.walletCard();
    if (!card) throw new Error('No policy card on this phone');
    const p = this.patient.actor;
    p.privateState = createPrivateState(p.privateState.secretKey, { terms: card.terms, salt: card.salt }, o.claim);
    return pureCircuits.consentTag(pureCircuits.recordCommitment(o.claim.record, o.claim.salt), pureCircuits.policyCommitment(card.terms, card.salt), o.claim.salt);
  }

  consent(recordId: string) {
    return this.run('Consent', async () => {
      const tag = this.asPatientFor(recordId);
      await this.act(this.patient.actor, actions.consentToClaim());
      await this.caughtUp(() => this.ledger.consents.member(tag));
      this.withdrawn.delete(recordId);
    });
  }

  /** Ledger order decides: once this lands, the hospital can't settle the bill, even with a proof made earlier. */
  withdrawConsent(recordId: string) {
    return this.run('Withdraw consent', async () => {
      const tag = this.asPatientFor(recordId);
      await this.act(this.patient.actor, actions.withdrawConsent());
      this.withdrawn.add(recordId);
      await this.caughtUp(() => !this.ledger.consents.member(tag));
    });
  }

  grantAccess(recordId: string, role: GranteeRole, seconds: number) {
    return this.run('Grant access', async () => {
      const o = this.mine(recordId);
      const grantee = this.care[role];
      const wrapped = await grantKeyFor(o.keys, role, await this.encKey(grantee.pk, grantee.name));
      const p = this.patient.actor;
      p.privateState = createPrivateState(p.privateState.secretKey, null, o.claim);
      const now = this.asOf();
      await this.act(p, actions.grantAccess(unhex(grantee.pk), BigInt(ROLE_CODES[role]), BigInt(now + seconds), wrapped, BigInt(now)));
    });
  }

  revokeAccess(recordId: string, role: GranteeRole) {
    return this.run('Revoke access', async () => {
      const o = this.mine(recordId);
      const grantee = this.care[role];
      const recipients = { owner: this.patient.enc.publicKey, hospital: await this.encKey(o.claim.record.hospitalPk, 'The hospital'), emergency: this.emergencyKeyOnChain() };
      const { sealed, sectionKeys } = await resealRecord(o.sealed, o.keys, recipients);
      const newCid = await putJson(this.store, sealed);
      const p = this.patient.actor;
      p.privateState = createPrivateState(p.privateState.secretKey, null, o.claim);
      const now = this.asOf();
      await this.act(p, actions.revokeAccess(unhex(grantee.pk), newCid, BigInt(now)));
      // The new copy has new keys: hand them to everyone else who still has access, so only the revoked one loses it.
      const others = this.grantsFrom(this.ledger).filter((g) => g.record === recordId && g.granteePk !== grantee.pk && g.role !== 'emergency' && (g.expiresAt ?? 0) > now);
      for (const g of others) {
        const wrapped = await grantKeyFor(sectionKeys, g.role as GranteeRole, await this.encKey(g.granteePk, g.grantee));
        await this.act(p, actions.grantAccess(unhex(g.granteePk), BigInt(ROLE_CODES[g.role]), BigInt(g.expiresAt!), wrapped, BigInt(now)));
      }
    });
  }

  openShared(recordId: string, role: GranteeRole) {
    return this.run('Open record', async (): Promise<OpenedRecord> => {
      const me = this.care[role];
      const now = this.asOf();
      // Logged on-chain first: no log, no keys.
      await this.chain().call(me.actor, 'logView', unhex(recordId), NO_REASON, BigInt(now));
      const l = this.ledger;
      const key = pureCircuits.grantKey(unhex(recordId), unhex(me.pk));
      const keys = await unwrapGrant(l.grantKeys.lookup(key), me.enc);
      const sealed = await getJson<SealedRecord>(this.store, l.recordCids.lookup(unhex(recordId)));
      const { sections } = await openRecord(sealed, keys);
      return this.openedView(recordId, role, sections, Number(l.grants.lookup(key).expiresAt));
    });
  }

  breakGlass(recordId: string, why: string, as = 'unit7') {
    return this.run('Break glass', async (): Promise<OpenedRecord> => {
      const responder = this.responders.find((r) => r.id === as);
      if (!responder) throw new Error('Unknown responder');
      const text = why.trim() || 'No reason given';
      const hash = await sha256(text);
      const now = this.asOf();
      // A non-zero reason makes the view a break-glass: responder check, one-hour grant, loud audit entry.
      await this.chain().call(responder.actor, 'logView', unhex(recordId), hash, BigInt(now));
      this.reasons.set(hex(hash), text);
      const sealed = await getJson<SealedRecord>(this.store, this.ledger.recordCids.lookup(unhex(recordId)));
      const { sections } = await openRecord(sealed, await sectionKeysFor(sealed, 'emergency', this.emergency));
      return this.openedView(recordId, 'emergency', sections, now + 3600);
    });
  }

  private openedView(recordId: string, role: AccessRole, sections: Awaited<ReturnType<typeof openRecord>>['sections'], until: number): OpenedRecord {
    const { patientName } = headline(sections);
    return {
      recordId,
      role,
      visible: Object.keys(sections) as SectionName[],
      sections: describe(sections),
      until,
      title: patientName ? `${patientName}'s record` : `Record ${fingerprint(recordId)}`,
    };
  }

  // ---------- Demo controls ----------

  /** The cast for a new contract: fresh identities in demo mode. */
  protected newCast(): Promise<Cast> {
    return freshCast();
  }

  /** A new contract with the cast's insurer; the emergency key every record is also sealed to is fixed here. */
  protected async newChain(cast: Cast): Promise<Chain> {
    this.store = memoryStore();
    return ClaimSimulator.create(this.insurer.actor, witnesses, new Uint8Array(cast.emergency.publicKey));
  }

  protected adopt({ people, emergency }: Cast) {
    const by = (id: string) => people.find((p) => p.id === id)!;
    this.insurer = by('insurer');
    this.patient = by('patient');
    this.hospitals = ['juniper', 'harbour', 'quickfix'].map(by);
    this.care = { doctor: by('doctor'), lab: by('lab'), pharmacy: by('pharmacy') };
    this.responders = ['unit7', 'volunteer'].map(by);
    this.emergency = emergency;
    this.names = new Map<string, { name: string; role?: AccessRole }>([
      ...[this.insurer, ...this.hospitals, this.patient].map((p) => [p.pk, { name: p.name }] as const),
      ...(['doctor', 'lab', 'pharmacy'] as const).map((r) => [this.care[r].pk, { name: this.care[r].name, role: r }] as const),
      ...this.responders.map((p) => [p.pk, { name: p.name, role: 'emergency' as const }] as const),
    ]);
  }

  /** Forget what this browser knew about the previous contract. */
  protected forget() {
    this.skew = 0;
    this.leafOf = new Map();
    this.funded = 0n;
    this.book = [];
    this.made = [];
    this.claimMeta = new Map();
    this.reasons = new Map();
    this.withdrawn = new Set();
    this.cards = new Map();
    this.opened = new Map();
    this.desk = 'juniper';
  }

  reset() {
    return this.run('Reset', async () => {
      const cast = await this.newCast();
      this.adopt(cast);
      this.sim = await this.newChain(cast);
      this.forget();
    });
  }

  async seedStory(judge = false) {
    await this.reset();
    await this.fundPool(50_000n * NIGHT);
    await this.approveHospital('juniper');
    await this.approveHospital('harbour');
    await this.setResponder('unit7', true);
    const covered = PROCEDURES.filter((p) => p.code !== COSMETIC).map((p) => p.code);
    const card = await this.issuePolicy({ holderName: 'Rohan Iyer', plan: 'Gold Family', limit: 5_000n * NIGHT, validDays: 365, covered });
    this.setDesk('juniper');
    const patient = { name: card.holderName, birthDate: '1979-04-12', gender: 'male' as const };
    const encounter = { start: new Date(this.now() * 1000).toISOString(), hospital: 'St. Juniper General' };
    for (const id of judge ? ['cardiac', 'knee'] : ['cardiac']) {
      const r = await this.createRecord(card, { ...SAMPLE_CASES.find((c) => c.id === id)!.input, patient, encounter });
      if (judge) await this.consent(r.id);
    }
  }

  skipAhead(seconds: number) {
    this.skew += seconds;
    this.emit();
  }
}
