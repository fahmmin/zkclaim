import { useState } from 'react';
import { Pixel } from '../art';
import { useService, useSnap } from '../ctx';
import { attempt, Card, Data, Headline, Meta } from '../ds';
import type { LiveService } from '../live';
import { night, short } from '../service';
import { copy } from './Patient';
import { DEFAULT_NETWORK_ID } from '../../midnight';

const dust = (specks: bigint) => (Number(specks / 10n ** 12n) / 1000).toLocaleString('en-US', { maximumFractionDigits: 3 });

/** Live mode before a contract is chosen: connect 1AM, then deploy a new contract or join one. */
export default function LiveGate({ onDemo }: { onDemo: () => void }) {
  const svc = useService() as LiveService;
  const s = useSnap();
  const l = s.live;
  const [net, setNet] = useState(l?.networkId || DEFAULT_NETWORK_ID);
  const [address, setAddress] = useState(l?.savedContract ?? '');
  const fund = l?.address ? `npm run fund -- ${l.address}` : '';

  return (
    <div className="bento">
      <Card tone="cobalt" className="s7">
        <Meta>
          <span>Live mode</span>
          <span>1AM wallet, network {net}</span>
        </Meta>
        <Headline size="l" className="up">
          Live on Midnight
        </Headline>
        <p className="lede">Every action becomes a real zero-knowledge proof and transaction. 1AM asks you to approve each one; sealed cards and records go to IPFS.</p>
        {!l?.wallet ? (
          <form
            className="row"
            onSubmit={(e) => {
              e.preventDefault();
              void attempt(() => svc.connect(net.trim() || DEFAULT_NETWORK_ID), 'Wallet connected');
            }}
          >
            <label className="field grow">
              <span>Network</span>
              <input value={net} onChange={(e) => setNet(e.target.value)} />
            </label>
            <button className="btn light" disabled={!!s.busy} style={{ alignSelf: 'flex-end' }}>
              {s.busy === 'Connect 1AM' ? 'Waiting for 1AM…' : 'Connect 1AM'}
            </button>
          </form>
        ) : (
          <>
            <dl className="ruled c2">
              <div>
                <dt>Wallet</dt>
                <dd>{l.wallet}</dd>
              </div>
              <div>
                <dt>Address</dt>
                <dd className="data">{l.address ? short(l.address, 14, 6) : ''}</dd>
              </div>
              <div>
                <dt>NIGHT</dt>
                <dd>{night(l.night)}</dd>
              </div>
              <div>
                <dt>DUST for fees</dt>
                <dd>{dust(l.dust)}</dd>
              </div>
            </dl>
            <div className="row">
              <span className={`chip ${l.ipfs === 'kubo' ? 'ok' : 'warn'}`}>{l.ipfs === 'kubo' ? 'IPFS: local Kubo node' : 'No IPFS node here: sealed data is kept in this browser'}</span>
              <button className="btn sm ghost" disabled={!!s.busy} onClick={() => attempt(() => svc.refreshBalances())}>
                Refresh balances
              </button>
            </div>
            <div className="row">
              <button className="btn big light" disabled={!!s.busy || l.night === 0n} onClick={() => attempt(() => svc.deploy(), 'Contract deployed: this browser is the insurer')}>
                {s.busy === 'Reset' ? 'Deploying… approve in 1AM' : 'Deploy a new contract'}
              </button>
            </div>
            <form
              className="row"
              onSubmit={(e) => {
                e.preventDefault();
                void attempt(() => svc.join(address), 'Joined the contract');
              }}
            >
              <label className="field grow">
                <span>Or join a contract</span>
                <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="64 hex characters" spellCheck={false} />
              </label>
              <button className="btn ghost" disabled={!address.trim() || !!s.busy} style={{ alignSelf: 'flex-end' }}>
                Join
              </button>
            </form>
          </>
        )}
        <div className="row">
          <button className="btn sm ghost" onClick={onDemo}>
            Back to demo mode
          </button>
          <a className="btn sm ghost" href="#/wallet-check">
            Wallet check
          </a>
        </div>
      </Card>
      <Card tone="paper" className="s5">
        <Meta>
          <span>Before you go live</span>
          <span>Local devnet</span>
        </Meta>
        <ol className="plain">
          <li>
            Start the network, proof server and IPFS: <Data>npm run env:up</Data>
          </li>
          <li>Unlock 1AM in this Chrome profile, on its Local network.</li>
          <li>
            Give the wallet NIGHT: <Data>{fund || 'npm run fund -- <address>'}</Data>
            {fund && (
              <button className="btn sm ghost" style={{ marginLeft: 8 }} onClick={() => copy(fund, 'Command')}>
                Copy
              </button>
            )}
          </li>
          <li>Turn on DUST generation in 1AM and wait for DUST to pay fees.</li>
          <li>Deploy: this browser becomes the insurer and keeps every role's identity.</li>
        </ol>
        <Pixel art="computer" scale={9} style={{ alignSelf: 'flex-end' }} />
      </Card>
    </div>
  );
}

/** Live mode with a contract: one strip with the wallet, storage, contract and what 1AM is waiting on. */
export function LiveBar() {
  const svc = useService() as LiveService;
  const s = useSnap();
  const l = s.live;
  return (
    <div className="livebar" role="status">
      <span className="chip ok">Live</span>
      <span>{l?.wallet}</span>
      <span>{night(l?.night ?? 0n)}</span>
      <span className={`chip ${l?.ipfs === 'kubo' ? 'solid' : 'warn'}`}>{l?.ipfs === 'kubo' ? 'IPFS' : 'Stored in this browser'}</span>
      <span className="grow" />
      {s.busy && (
        <span className="waiting">
          <span className="busy-dot" /> {s.busy}: proving, approve in 1AM
        </span>
      )}
      <button className="btn sm ghost" onClick={() => svc.leave()} disabled={!!s.busy}>
        Leave contract
      </button>
    </div>
  );
}
