// Browser side of zkClaim: connects the 1AM wallet (or any DApp connector v4 wallet) and builds Midnight.js providers
// on it. The wallet proves, balances, pays fees and submits; private state never leaves this tab.
import { CostModel } from '@midnight-ntwrk/midnight-js-protocol/v9';
import { CompiledContract } from '@midnight-ntwrk/midnight-js-protocol/v9/compact-js';
import type { Configuration, ConnectedAPI, InitialAPI } from '@midnightntwrk/dapp-connector-api';
import { FetchZkConfigProvider } from '@midnight-ntwrk/midnight-js-fetch-zk-config-provider';
import {
  dappConnectorNetwork,
  dappConnectorProofProvider,
  dappConnectorWalletProviders,
} from '@midnight-ntwrk/midnight-js-dapp-connector-proof-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import type { MidnightProviders } from '@midnight-ntwrk/midnight-js-types';
import { Contract, witnesses } from '@zkclaim/contract';
import { inMemoryPrivateStateProvider } from './in-memory-private-state-provider';

/** The network the wallet must be on: the local devnet, `undeployed`, unless VITE_NETWORK_ID says otherwise. */
export const DEFAULT_NETWORK_ID = import.meta.env.VITE_NETWORK_ID || 'undeployed';

export const CompiledZkClaim = CompiledContract.make('ZkClaim', Contract).pipe(
  CompiledContract.withWitnesses(witnesses),
  // Only a label in the browser: the keys come from the zkConfigProvider below.
  CompiledContract.withCompiledFileAssets('./managed/zkclaim'),
);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ZkClaimProviders = MidnightProviders<any>;
export type Wallet = { name: string; api: ConnectedAPI; config: Configuration; providers: ZkClaimProviders };

/** Injected wallets speaking connector API v4, 1AM first. */
const findWallet = (): InitialAPI | undefined => {
  const v4 = Object.entries(globalThis.midnight ?? {}).filter(([, w]) => typeof w?.connect === 'function' && w.apiVersion?.startsWith('4.'));
  return (v4.find(([key]) => key === '1am') ?? v4[0])?.[1];
};

// 1AM answers "Request failed" / "No response from wallet background script" while its service worker wakes up.
async function connectWithRetry(wallet: InitialAPI, networkId: string): Promise<ConnectedAPI> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await wallet.connect(networkId);
    } catch (e) {
      const transient = /request failed|no response from wallet|forwarding/i.test(e instanceof Error ? e.message : String(e));
      if (!transient || attempt >= 4) throw e;
      await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
}

export async function connectWallet(networkId: string): Promise<Wallet> {
  const initial = findWallet();
  if (!initial) throw new Error('No Midnight wallet found. Install 1AM in this Chrome profile, then reload the page.');
  const api = await connectWithRetry(initial, networkId);
  const [config, network] = await Promise.all([api.getConfiguration(), dappConnectorNetwork(api)]);
  // Keys, ZKIR and the integrity manifest are served from this site's root (vite publicDir).
  const zkConfigProvider = new FetchZkConfigProvider(window.location.origin, { fetchFunc: fetch.bind(window) });
  const providers: ZkClaimProviders = {
    privateStateProvider: inMemoryPrivateStateProvider(),
    zkConfigProvider,
    proofProvider: await dappConnectorProofProvider(api, zkConfigProvider, CostModel.initialCostModel()),
    // The provider's default WebSocket is Node-only; hand it the browser's.
    publicDataProvider: indexerPublicDataProvider({ ...network.indexer, webSocket: WebSocket as never }),
    ...(await dappConnectorWalletProviders(api)),
    config: { networkId: network.networkId, ttlSeconds: 3600 },
  };
  return { name: initial.name, api, config, providers };
}

const NIGHT = '0'.repeat(64);

export async function readBalances(api: ConnectedAPI) {
  const [{ unshieldedAddress }, unshielded, dust] = await Promise.all([api.getUnshieldedAddress(), api.getUnshieldedBalances(), api.getDustBalance()]);
  return { unshieldedAddress, night: unshielded[NIGHT] ?? 0n, dust: dust.balance };
}
export type Balances = Awaited<ReturnType<typeof readBalances>>;

/** An error with its causes, which Midnight.js nests (ProviderFailedError → the wallet's own error). */
export const errorText = (e: unknown): string => {
  const parts: string[] = [];
  for (let x: unknown = e; x && parts.length < 4; x = (x as { cause?: unknown }).cause) parts.push(x instanceof Error ? x.message : String(x));
  return parts.join(' ← ');
};
