// Records and access end-to-end with real zero-knowledge proofs on a Midnight network:
// the hospital seals a FHIR record to IPFS and anchors it, the patient reads it and grants a doctor, the doctor
// logs the view and decrypts only the doctor's sections, the patient revokes (re-encrypts), and an emergency
// responder breaks the glass. Local devnet: `npm run env:up`, then `npm run demo:access`.
import { createHash, randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';
import pino from 'pino';
import { CompiledContract } from '@midnight-ntwrk/midnight-js-protocol/v9/compact-js';
import { deployContract, submitCallTx } from '@midnight-ntwrk/midnight-js-contracts';
import type { EnvironmentConfiguration } from '@midnight-ntwrk/testkit-js';
import { type ActionName, actions, AuditKind, Contract, createPrivateState, ledger, NO_REASON, pureCircuits, type TreatmentRecord, witnesses } from '@zkclaim/contract';
import {
  buildBundle,
  contentHash,
  getJson,
  grantKeyFor,
  kuboStore,
  memoryStore,
  newEncIdentity,
  openRecord,
  putJson,
  resealRecord,
  ROLE_CODES,
  SAMPLE_CASES,
  type SealedRecord,
  sealRecord,
  sectionKeysFor,
  unwrapGrant,
} from '@zkclaim/records';
import { getConfig } from './config.js';
import { startWallet, waitForDust } from './wallet.js';
import { buildProviders, ledgerState, type ZkClaimProviders } from './providers.js';

// @ts-expect-error the indexer client's GraphQL subscriptions need a global WebSocket in Node
globalThis.WebSocket = WebSocket;

const logger = pino({ level: process.env['LOG_LEVEL'] ?? 'warn', transport: { target: 'pino-pretty' } });
const say = (msg: string) => console.log(msg);
const short = (b: Uint8Array | string) => `${(typeof b === 'string' ? b : Buffer.from(b).toString('hex')).slice(0, 10)}…`;

const zkConfigPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../contract/src/managed/zkclaim');
const CompiledZkClaim = CompiledContract.make('ZkClaim', Contract).pipe(
  CompiledContract.withWitnesses(witnesses),
  CompiledContract.withCompiledFileAssets(zkConfigPath),
);

const network = process.env['MIDNIGHT_NETWORK'] ?? 'local';
const config = getConfig();
const env: EnvironmentConfiguration = { walletNetworkId: config.networkId, ...config };

const timed = async <T>(label: string, f: () => Promise<T>): Promise<T> => {
  const t = Date.now();
  process.stdout.write(`  ${label} … `);
  const r = await f();
  say(`done (${((Date.now() - t) / 1000).toFixed(1)}s)`);
  return r;
};

// zkClaim identities are separate from wallets: the wallet only pays fees, so the doctor and the responder
// share the insurer's wallet here.
type Role = 'insurer' | 'hospital' | 'patient' | 'doctor' | 'responder';
const WALLET_OF: Record<Role, 'INSURER' | 'HOSPITAL' | 'PATIENT'> = {
  insurer: 'INSURER',
  hospital: 'HOSPITAL',
  patient: 'PATIENT',
  doctor: 'INSURER',
  responder: 'INSURER',
};

async function main() {
  say(`\nzkClaim records and access on '${network}'\n`);
  // Kubo when it is up (npm run env:up starts it), else an in-memory store so the demo still runs.
  const kubo = kuboStore();
  const store = await kubo.put(new TextEncoder().encode('ping')).then(
    () => (say('  storage: local IPFS (Kubo)'), kubo),
    () => (say('  storage: in-memory (Kubo not reachable)'), memoryStore()),
  );

  const walletNames = ['INSURER', 'HOSPITAL', 'PATIENT'] as const;
  const wallets = await timed('Syncing wallets', () =>
    Promise.all(walletNames.map((role) => startWallet(logger, env, { network, role, faucet: config.faucet, syncTimeoutMs: 10 * 60_000 }))),
  );
  if (network === 'local') await timed('Waiting for DUST', () => Promise.all(wallets.map((w) => waitForDust(logger, w.wallet, 1, 180_000, config.indexer))));
  const providersOf = Object.fromEntries(walletNames.map((name, i) => [name, buildProviders(wallets[i], zkConfigPath, config)])) as Record<string, ZkClaimProviders>;
  const prov = (role: Role) => providersOf[WALLET_OF[role]];

  const roles: Role[] = ['insurer', 'hospital', 'patient', 'doctor', 'responder'];
  const sk = Object.fromEntries(roles.map((r) => [r, new Uint8Array(randomBytes(32))])) as Record<Role, Uint8Array>;
  const id = (r: Role) => pureCircuits.publicKey(sk[r]);
  const enc = Object.fromEntries(await Promise.all([...roles, 'emergency'].map(async (r) => [r, await newEncIdentity()]))) as Record<Role | 'emergency', Awaited<ReturnType<typeof newEncIdentity>>>;

  say('\nInsurer');
  const deployed = await timed('Deploying zkClaim', () =>
    deployContract(prov('insurer'), {
      compiledContract: CompiledZkClaim,
      privateStateId: 'insurer',
      initialPrivateState: createPrivateState(sk.insurer),
      args: [id('insurer'), enc.emergency.publicKey],
    }),
  );
  const contractAddress = deployed.deployTxData.public.contractAddress;
  say(`  contract: ${contractAddress}`);

  const privateStates = Object.fromEntries(roles.map((r) => [r, createPrivateState(sk[r])])) as Record<Role, ReturnType<typeof createPrivateState>>;
  // A circuit, or a named action (addHospital, grantAccess, ...) that runs a shared circuit.
  const call = async (who: Role, name: string, ...given: unknown[]) => {
    const { circuitId, args } = name in actions ? (actions[name as ActionName] as (...a: unknown[]) => { circuitId: string; args: unknown[] })(...given) : { circuitId: name, args: given };
    await prov(who).privateStateProvider.forContract(contractAddress).set(who, privateStates[who]);
    return submitCallTx(prov(who), {
      compiledContract: CompiledZkClaim,
      contractAddress,
      privateStateId: who,
      circuitId,
      ...(args.length ? { args } : {}),
    } as unknown as Parameters<typeof submitCallTx>[1]);
  };
  const nowS = () => BigInt(Math.floor(Date.now() / 1000) + 30);
  const readLedger = async () => ledger(ledgerState(await prov('insurer').publicDataProvider.queryContractState(contractAddress)));

  await timed('Approving the hospital', () => call('insurer', 'addHospital', id('hospital')));
  await timed('Approving an emergency responder', () => call('insurer', 'setResponder', id('responder'), true));

  say('\nHospital');
  const input = SAMPLE_CASES.find((c) => c.id === 'cardiac')!.input;
  const bundle = buildBundle(input);
  const record: TreatmentRecord = {
    patientPk: id('patient'),
    hospitalPk: id('hospital'),
    procedureCode: BigInt(input.procedure.code),
    amount: input.amount,
    contentHash: await contentHash(bundle),
  };
  const rec = { record, salt: new Uint8Array(randomBytes(32)) };
  const recordC = pureCircuits.recordCommitment(record, rec.salt);
  const { sealed } = await sealRecord(bundle, rec, { owner: enc.patient.publicKey, hospital: enc.hospital.publicKey, emergency: enc.emergency.publicKey });
  const cid = await putJson(store, sealed);
  say(`  sealed FHIR bundle (${bundle.entry.length} resources) stored as ${cid}`);
  await timed(`Anchoring record ${short(recordC)}`, () => call('hospital', 'anchorRecord', recordC, cid));

  say('\nPatient');
  const onChainCid = (await readLedger()).recordCids.lookup(recordC);
  const mine = await getJson<SealedRecord>(store, onChainCid);
  const ownerKeys = await sectionKeysFor(mine, 'owner', enc.patient);
  const opened = await openRecord(mine, ownerKeys);
  say(`  decrypted own record: ${Object.keys(opened.sections).join(', ')} + claim data (${opened.claimData ? 'yes' : 'no'})`);
  privateStates.patient = createPrivateState(sk.patient, null, opened.claimData!);
  const wrapped = await grantKeyFor(ownerKeys, 'doctor', enc.doctor.publicKey);
  await timed('Granting the doctor 1 hour of access', () => call('patient', 'grantAccess', id('doctor'), BigInt(ROLE_CODES.doctor), nowS() + 3600n, wrapped, nowS()));

  say('\nDoctor');
  await timed('Logging the view on-chain', () => call('doctor', 'logView', recordC, NO_REASON, nowS()));
  const grantKey = pureCircuits.grantKey(recordC, id('doctor'));
  const doctorKeys = await unwrapGrant((await readLedger()).grantKeys.lookup(grantKey), enc.doctor);
  const seen = await openRecord(mine, doctorKeys);
  say(`  doctor can read: ${Object.keys(seen.sections).join(', ')}; claim data: ${seen.claimData ? 'VISIBLE (bug!)' : 'hidden'}`);

  say('\nPatient');
  const { sealed: resealed } = await resealRecord(mine, ownerKeys, { owner: enc.patient.publicKey, hospital: enc.hospital.publicKey, emergency: enc.emergency.publicKey });
  const newCid = await putJson(store, resealed);
  await timed('Revoking the doctor (record re-encrypted)', () => call('patient', 'revokeAccess', id('doctor'), newCid, nowS()));
  const denied = await call('doctor', 'logView', recordC, NO_REASON, nowS()).then(
    () => 'ALLOWED (bug!)',
    (e: unknown) => `rejected: ${e instanceof Error ? e.message : e}`,
  );
  say(`  doctor tries again: ${denied}`);

  say('\nEmergency responder');
  const reason = new Uint8Array(createHash('sha256').update('Unconscious patient in ER, allergy check').digest());
  await timed('Breaking the glass (logged with the reason, then the view)', () => call('responder', 'logView', recordC, reason, nowS()));
  const latest = await getJson<SealedRecord>(store, (await readLedger()).recordCids.lookup(recordC));
  const emergency = await openRecord(latest, await sectionKeysFor(latest, 'emergency', enc.emergency));
  say(`  responder reads: ${Object.keys(emergency.sections).join(', ')}`);

  say('\nOn-chain audit trail (the patient never appears)');
  const names = new Map(roles.map((r) => [Buffer.from(id(r)).toString('hex'), r]));
  for (const [i, e] of [...(await readLedger()).audit].sort(([a], [b]) => (a < b ? -1 : 1))) {
    // Grants and revokes name the grantee (the owner stays anonymous); views and break-glass name the reader.
    const who = names.get(Buffer.from(e.actor).toString('hex')) ?? short(e.actor);
    const subject = e.kind === AuditKind.granted || e.kind === AuditKind.revoked ? `for ${who}` : `by ${who}`;
    say(`  #${i} ${AuditKind[e.kind].padEnd(10)} ${subject.padEnd(14)} at ${new Date(Number(e.at) * 1000).toISOString()}`);
  }

  if (!denied.startsWith('rejected') || seen.claimData) throw new Error('Access demo did not behave as expected');
  await Promise.all(wallets.map((w) => w.stop()));
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
