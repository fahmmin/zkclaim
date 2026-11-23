// Gives browser wallets (e.g. 1AM on its "Local" network) NIGHT on the local devnet, paid from a genesis-funded
// wallet, so they can fund the claims pool and register NIGHT for DUST to pay fees.
// Usage: npm run fund -- <mn_addr_undeployed1…> [<mn_addr_undeployed1…> …]
import { WebSocket } from 'ws';
import pino from 'pino';
import { unshieldedToken } from '@midnight-ntwrk/midnight-js-protocol/v9';
import { MidnightBech32m, UnshieldedAddress } from '@midnightntwrk/wallet-sdk';
import type { EnvironmentConfiguration } from '@midnight-ntwrk/testkit-js';
import { LOCAL_CONFIG as config } from './config.js';
import { startWallet, waitForDust } from './wallet.js';

// @ts-expect-error the indexer client's GraphQL subscriptions need a global WebSocket in Node
globalThis.WebSocket = WebSocket;

// Base units per wallet; the genesis wallet holds 250,000,000,000,000. Enough NIGHT for pool deposits and fast DUST.
const AMOUNT = 10_000_000_000_000n;

async function main() {
  if ((process.env['MIDNIGHT_NETWORK'] ?? 'local') !== 'local') throw new Error('fund only runs on the local devnet: it spends a genesis wallet.');
  const addresses = process.argv.slice(2).filter((a) => a !== '--');
  if (addresses.length === 0) throw new Error('Usage: npm run fund -- <mn_addr_undeployed1…> [more addresses]');
  // Parse before syncing, so a mistyped or wrong-network address fails fast.
  const receivers = addresses.map((a) => {
    try {
      return MidnightBech32m.parse(a.trim()).decode(UnshieldedAddress, config.networkId);
    } catch (e) {
      throw new Error(`Not an unshielded address on '${config.networkId}' (expected mn_addr_${config.networkId}1…): ${a} (${e instanceof Error ? e.message : e})`);
    }
  });

  const logger = pino({ level: process.env['LOG_LEVEL'] ?? 'warn', transport: { target: 'pino-pretty' } });
  const env: EnvironmentConfiguration = { walletNetworkId: config.networkId, ...config };
  // Only ALICE, BOB and CHARLIE are genesis-funded locally. CHARLIE is the CLI demo's patient, who spends the least.
  const w = await startWallet(logger, env, { network: 'local', role: 'CHARLIE', faucet: '', syncTimeoutMs: 10 * 60_000 });
  await waitForDust(logger, w.wallet, 1, 180_000, config.indexer);

  const recipe = await w.wallet.transferTransaction(
    [{ type: 'unshielded', outputs: receivers.map((receiverAddress) => ({ type: unshieldedToken().raw, receiverAddress, amount: AMOUNT })) }],
    { ttl: new Date(Date.now() + 30 * 60_000) },
  );
  const signed = await w.wallet.signRecipe(recipe, (payload) => w.unshieldedKeystore.signDataAsync(payload));
  const txId = await w.wallet.submitTransaction(await w.wallet.finalizeRecipe(signed));
  console.log(`Sent ${AMOUNT} NIGHT units to ${addresses.length} wallet(s) in ${txId}.`);
  console.log('Next, in each wallet: turn on DUST generation for this NIGHT, then wait for DUST before transacting.');
  await w.stop();
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  },
);
