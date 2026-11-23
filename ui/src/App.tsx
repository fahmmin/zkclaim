// Wallet check (Spike C): can a browser wallet on the local devnet deploy zkClaim and sign a call?
// This page becomes the shell of the three-role app.
import { useState } from 'react';
import { deployContract, submitCallTx } from '@midnight-ntwrk/midnight-js-contracts';
import { createPrivateState, pureCircuits } from '@zkclaim/contract';
import { type Balances, CompiledZkClaim, connectWallet, DEFAULT_NETWORK_ID, errorText, readBalances, type Wallet } from './midnight';

const PRIVATE_STATE_ID = 'zkclaim';

/** This browser profile's zkClaim identity key. It proves the role; the wallet only pays fees. */
function identityKey(): Uint8Array {
  const saved = localStorage.getItem('zkclaim-identity');
  if (saved) return Uint8Array.from(atob(saved), (c) => c.charCodeAt(0));
  const sk = crypto.getRandomValues(new Uint8Array(32));
  localStorage.setItem('zkclaim-identity', btoa(String.fromCharCode(...sk)));
  return sk;
}

const formatDust = (specks: bigint) => (Number(specks / 10n ** 12n) / 1000).toLocaleString(undefined, { maximumFractionDigits: 3 });

type LogLine = { at: string; ok: boolean; text: string };

export default function App() {
  const [networkId, setNetworkId] = useState(() => localStorage.getItem('zkclaim-network') ?? DEFAULT_NETWORK_ID);
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [balances, setBalances] = useState<Balances | null>(null);
  const [contract, setContract] = useState(() => localStorage.getItem('zkclaim-contract') ?? '');
  const [joinInput, setJoinInput] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [log, setLog] = useState<LogLine[]>([]);

  const note = (ok: boolean, text: string) => setLog((l) => [{ at: new Date().toLocaleTimeString(), ok, text }, ...l]);

  const run = (label: string, task: () => Promise<string>) => async () => {
    setBusy(label);
    const started = performance.now();
    try {
      const result = await task();
      note(true, `${label}: ${result} (${((performance.now() - started) / 1000).toFixed(1)}s)`);
    } catch (e) {
      console.error(label, e);
      note(false, `${label} failed: ${errorText(e)}`);
    } finally {
      setBusy(null);
    }
  };

  const connect = run('Connect', async () => {
    localStorage.setItem('zkclaim-network', networkId);
    const w = await connectWallet(networkId);
    setWallet(w);
    setBalances(await readBalances(w.api));
    return `${w.name} on ${networkId}`;
  });

  const refresh = run('Refresh balances', async () => {
    const b = await readBalances(wallet!.api);
    setBalances(b);
    return `${b.night.toLocaleString()} NIGHT units, ${formatDust(b.dust)} DUST`;
  });

  const deploy = run('Deploy', async () => {
    const sk = identityKey();
    const deployed = await deployContract(wallet!.providers, {
      compiledContract: CompiledZkClaim,
      privateStateId: PRIVATE_STATE_ID,
      initialPrivateState: createPrivateState(sk),
      // No emergency key here: this page only checks deploy and signing; the app's live mode deploys with one.
      args: [pureCircuits.publicKey(sk), new Uint8Array(32)],
    });
    const address = deployed.deployTxData.public.contractAddress;
    localStorage.setItem('zkclaim-contract', address);
    setContract(address);
    return `zkClaim deployed at ${address}; this profile is the insurer`;
  });

  const join = () => {
    const address = joinInput.trim().replace(/^0x/i, '').toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(address)) return note(false, 'Join failed: a contract address is 64 hex characters');
    localStorage.setItem('zkclaim-contract', address);
    setContract(address);
    note(true, `Joined contract ${address}`);
  };

  const forget = () => {
    localStorage.removeItem('zkclaim-contract');
    setContract('');
  };

  const fundPool = run('Fund pool', async () => {
    await wallet!.providers.privateStateProvider.forContract(contract).set(PRIVATE_STATE_ID, createPrivateState(identityKey()));
    const res = await submitCallTx(wallet!.providers, {
      compiledContract: CompiledZkClaim,
      contractAddress: contract,
      privateStateId: PRIVATE_STATE_ID,
      circuitId: 'fundPool',
      args: [1_000n],
    });
    setBalances(await readBalances(wallet!.api));
    return `paid 1,000 NIGHT units into the pool in tx ${res.public.txId}`;
  });

  const copy = (text: string) => navigator.clipboard.writeText(text).then(() => note(true, 'Copied to clipboard'));
  const fundCommand = balances ? `npm run fund -- ${balances.unshieldedAddress}` : '';

  return (
    <main>
      <header>
        <h1>zkClaim</h1>
        <p>Wallet check: can this browser's wallet deploy zkClaim and sign a call on the local Midnight network?</p>
      </header>

      <section>
        <h2>
          <span>1</span> Wallet
        </h2>
        {!wallet ? (
          <div className="row">
            <label>
              Network <input value={networkId} onChange={(e) => setNetworkId(e.target.value)} />
            </label>
            <button onClick={connect} disabled={!!busy}>
              {busy === 'Connect' ? 'Waiting for wallet…' : 'Connect 1AM'}
            </button>
          </div>
        ) : (
          <>
            <dl>
              <dt>Wallet</dt>
              <dd>{wallet.name}</dd>
              <dt>Network</dt>
              <dd>{networkId}</dd>
              <dt>Node</dt>
              <dd className="mono">{wallet.config.substrateNodeUri}</dd>
              <dt>Indexer</dt>
              <dd className="mono">{wallet.config.indexerUri}</dd>
              <dt>Prover</dt>
              <dd className="mono">{wallet.config.proverServerUri ?? 'wallet default'}</dd>
              <dt>Address</dt>
              <dd className="mono">{balances?.unshieldedAddress}</dd>
              <dt>NIGHT</dt>
              <dd>{balances?.night.toLocaleString()} units</dd>
              <dt>DUST</dt>
              <dd>{balances && formatDust(balances.dust)}</dd>
            </dl>
            {balances?.night === 0n && (
              <div className="hint">
                <p>This wallet has no NIGHT. From the repo, run:</p>
                <p className="mono">{fundCommand}</p>
                <button className="secondary" onClick={() => copy(fundCommand)}>
                  Copy command
                </button>
              </div>
            )}
            {balances && balances.night > 0n && balances.dust === 0n && (
              <p className="hint">Turn on DUST generation in 1AM for this NIGHT, wait about 20 seconds, then refresh.</p>
            )}
            <button className="secondary" onClick={refresh} disabled={!!busy}>
              Refresh balances
            </button>
          </>
        )}
      </section>

      <section>
        <h2>
          <span>2</span> Contract
        </h2>
        {contract ? (
          <>
            <p className="mono">{contract}</p>
            <div className="row">
              <button className="secondary" onClick={() => copy(contract)}>
                Copy address
              </button>
              <button className="secondary" onClick={forget} disabled={!!busy}>
                Use another contract
              </button>
            </div>
          </>
        ) : (
          <>
            <button onClick={deploy} disabled={!wallet || !!busy}>
              {busy === 'Deploy' ? 'Deploying… approve in 1AM' : 'Deploy zkClaim (this profile becomes the insurer)'}
            </button>
            <div className="row">
              <input aria-label="Contract address to join" placeholder="or paste a contract address to join" value={joinInput} onChange={(e) => setJoinInput(e.target.value)} />
              <button className="secondary" onClick={join} disabled={!joinInput || !!busy}>
                Join
              </button>
            </div>
          </>
        )}
      </section>

      <section>
        <h2>
          <span>3</span> Sign a transaction
        </h2>
        <p className="muted">Pays 1,000 NIGHT units into the claims pool. The wallet proves, balances, signs and submits it.</p>
        <button onClick={fundPool} disabled={!wallet || !contract || !!busy}>
          {busy === 'Fund pool' ? 'Proving… approve in 1AM' : 'Fund pool with 1,000 NIGHT units'}
        </button>
      </section>

      <section>
        <h2>Log</h2>
        {log.length === 0 ? (
          <p className="muted">Nothing yet.</p>
        ) : (
          <ol className="log">
            {log.map((line, i) => (
              <li key={log.length - i} className={line.ok ? '' : 'bad'}>
                <time>{line.at}</time>
                {line.text}
              </li>
            ))}
          </ol>
        )}
      </section>
    </main>
  );
}
