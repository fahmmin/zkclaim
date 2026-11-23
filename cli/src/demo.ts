// End-to-end claim with real zero-knowledge proofs on a Midnight network:
// Insurer -> Patient -> Hospital -> automatic payout, then a replay that must fail.
// Local devnet: `npm run env:up`, then `npm run demo`. Also the stage fallback if a browser wallet misbehaves.
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';
import pino from 'pino';
import * as Rx from 'rxjs';
import { CompiledContract } from '@midnight-ntwrk/midnight-js-protocol/v9/compact-js';
import { encodeUserAddress } from '@midnight-ntwrk/midnight-js-protocol/v9/compact-runtime';
import { deployContract, submitCallTx } from '@midnight-ntwrk/midnight-js-contracts';
import type { EnvironmentConfiguration } from '@midnight-ntwrk/testkit-js';
import {
  Contract,
  createPrivateState,
  ledger,
  type PolicyTerms,
  pureCircuits,
  type TreatmentRecord,
  witnesses,
} from '@zkclaim/contract';
import { getConfig } from './config.js';
import { type MidnightWalletProvider, startWallet, waitForDust } from './wallet.js';
import { buildProviders, ledgerState, type ZkClaimProviders } from './providers.js';

// @ts-expect-error the indexer client's GraphQL subscriptions need a global WebSocket in Node
globalThis.WebSocket = WebSocket;

const logger = pino({ level: process.env['LOG_LEVEL'] ?? 'warn', transport: { target: 'pino-pretty' } });
const say = (msg: string) => console.log(msg);
const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');
const short = (b: Uint8Array) => `${hex(b).slice(0, 10)}…`;
const NIGHT = '0'.repeat(64);

const zkConfigPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../contract/src/managed/zkclaim');
const CompiledZkClaim = CompiledContract.make('ZkClaim', Contract).pipe(
  CompiledContract.withWitnesses(witnesses),
  CompiledContract.withCompiledFileAssets(zkConfigPath),
);

type Role = 'insurer' | 'hospital' | 'patient';

const network = process.env['MIDNIGHT_NETWORK'] ?? 'local';
const config = getConfig();
const env: EnvironmentConfiguration = {
  walletNetworkId: config.networkId,
  networkId: config.networkId,
  indexer: config.indexer,
  indexerWS: config.indexerWS,
  node: config.node,
  nodeWS: config.nodeWS,
  faucet: config.faucet,
  proofServer: config.proofServer,
};

const timed = async <T>(label: string, f: () => Promise<T>): Promise<T> => {
  const t = Date.now();
  process.stdout.write(`  ${label} … `);
  const r = await f();
  say(`done (${((Date.now() - t) / 1000).toFixed(1)}s)`);
  return r;
};

const nightBalance = async (w: MidnightWalletProvider) =>
  BigInt(((await Rx.firstValueFrom(w.wallet.state())).unshielded.balances as Record<string, bigint>)[NIGHT] ?? 0n);

const waitForBalance = async (w: MidnightWalletProvider, atLeast: bigint, timeoutMs = 90_000) => {
  const end = Date.now() + timeoutMs;
  let b = await nightBalance(w);
  while (b < atLeast && Date.now() < end) {
    await new Promise((r) => setTimeout(r, 2_000));
    b = await nightBalance(w);
  }
  return b;
};

async function main() {
  say(`\nzkClaim end-to-end on '${network}'\n`);

  const roles: Role[] = ['insurer', 'hospital', 'patient'];
  const wallets = await timed('Syncing insurer, hospital and patient wallets', () =>
    Promise.all(roles.map((role) => startWallet(logger, env, { network, role: role.toUpperCase(), faucet: config.faucet, syncTimeoutMs: 10 * 60_000 }))),
  );
  if (network === 'local') {
    await timed('Waiting for DUST to pay fees', () => Promise.all(wallets.map((w) => waitForDust(logger, w.wallet, 1, 180_000, config.indexer))));
  }
  const w = Object.fromEntries(roles.map((r, i) => [r, wallets[i]])) as Record<Role, MidnightWalletProvider>;
  const prov = Object.fromEntries(roles.map((r) => [r, buildProviders(w[r], zkConfigPath, config)])) as Record<Role, ZkClaimProviders>;

  // Each party's zkClaim identity key. Never leaves its device.
  const sk = Object.fromEntries(roles.map((r) => [r, new Uint8Array(randomBytes(32))])) as Record<Role, Uint8Array>;
  const pk = (r: Role) => pureCircuits.publicKey(sk[r]);

  // Off-chain: the insurer writes the policy and gives the card (terms + salt) to the patient.
  const ANGIOPLASTY = 101n;
  const terms: PolicyTerms = {
    holderPk: pk('patient'),
    limit: 1_000n,
    expiresAt: BigInt(Math.floor(Date.now() / 1000) + 365 * 86_400),
    covered: [ANGIOPLASTY, 202n, 0n, 0n, 0n, 0n, 0n, 0n],
  };
  const policy = { terms, salt: new Uint8Array(randomBytes(32)) };
  const policyC = pureCircuits.policyCommitment(terms, policy.salt);

  // Off-chain: the hospital treats the patient and writes the record (the FHIR bundle's hash goes in contentHash).
  const record: TreatmentRecord = {
    patientPk: pk('patient'),
    hospitalPk: pk('hospital'),
    procedureCode: ANGIOPLASTY,
    amount: 400n,
    contentHash: new Uint8Array(randomBytes(32)),
  };
  const rec = { record, salt: new Uint8Array(randomBytes(32)) };
  const recordC = pureCircuits.recordCommitment(record, rec.salt);

  say('\nInsurer');
  const deployed = await timed('Deploying zkClaim contract', () =>
    deployContract(prov.insurer, {
      compiledContract: CompiledZkClaim,
      privateStateId: 'insurer',
      initialPrivateState: createPrivateState(sk.insurer),
      args: [pk('insurer')],
    }),
  );
  const contractAddress = deployed.deployTxData.public.contractAddress;
  say(`  contract: ${contractAddress}`);

  // The patient shows the hospital their policy card; both hold the record.
  await prov.hospital.privateStateProvider.forContract(contractAddress).set('hospital', createPrivateState(sk.hospital, policy, rec));
  await prov.patient.privateStateProvider.forContract(contractAddress).set('patient', createPrivateState(sk.patient, policy, rec));

  const call = (who: Role, circuitId: string, ...args: unknown[]) =>
    submitCallTx(prov[who], {
      compiledContract: CompiledZkClaim,
      contractAddress,
      privateStateId: who,
      circuitId,
      ...(args.length ? { args } : {}),
    } as unknown as Parameters<typeof submitCallTx>[1]);

  await timed('Funding payout pool with 5000 NIGHT', () => call('insurer', 'fundPool', 5_000n));
  await timed('Approving hospital', () => call('insurer', 'addHospital', pk('hospital')));
  await timed(`Issuing policy ${short(policyC)}`, () => call('insurer', 'issuePolicy', policyC));

  say('\nHospital');
  await timed(`Anchoring encrypted record ${short(recordC)}`, () => call('hospital', 'anchorRecord', recordC, 'bafy-demo-record-cid'));

  say('\nPatient');
  await timed('Consenting to the claim', () => call('patient', 'consentToClaim'));

  say('\nHospital');
  const payTo = { bytes: encodeUserAddress(w.hospital.unshieldedKeystore.getAddress()) };
  const before = await nightBalance(w.hospital);
  const asOf = () => BigInt(Math.floor(Date.now() / 1000) + 600);
  const res = await timed('Proving and submitting claim for 400 NIGHT', () => call('hospital', 'submitClaim', 400n, asOf(), payTo));
  const after = await waitForBalance(w.hospital, before + 400n);
  say(`  hospital NIGHT: ${before} -> ${after} (+${after - before})`);
  say(`  nullifier: ${short(res.private.result as Uint8Array)}`);

  const replay = await call('hospital', 'submitClaim', 400n, asOf(), payTo).then(
    () => 'ACCEPTED (bug!)',
    (e: unknown) => `rejected: ${e instanceof Error ? e.message : String(e)}`,
  );
  say(`  replaying the same claim: ${replay}`);

  say('\nWhat the insurer sees on-chain');
  const l = ledger(ledgerState(await prov.insurer.publicDataProvider.queryContractState(contractAddress)));
  say(`  settled claims: ${l.claims.size()}, total paid: ${l.totalPaid}, paid on policy ${short(policyC)}: ${l.spent.lookup(policyC)}`);
  say('  never on-chain: procedure code, diagnosis, record contents, policy limit/expiry/covered set, which approved hospital, patient identity\n');

  if (after - before !== 400n || !replay.startsWith('rejected')) throw new Error('Demo did not behave as expected');
  await Promise.all(wallets.map((x) => x.stop()));
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
