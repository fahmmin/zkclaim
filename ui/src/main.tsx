import { Buffer } from 'buffer';
// Midnight's browser bundles expect Node's Buffer as a global.
(globalThis as unknown as { Buffer: typeof Buffer }).Buffer = Buffer;

import { StrictMode, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import WalletCheck from './App';
import { ErrorBoundary } from './zk/boundary';
import ZkApp from './zk/Shell';
import './app.css';
import './zk/ds.css';

const subscribe = (fn: () => void) => (addEventListener('hashchange', fn), () => removeEventListener('hashchange', fn));
const route = () => location.hash.replace(/^#\/?/, '');

function Root() {
  const path = useSyncExternalStore(subscribe, route);
  // The e2e wallet test drives this page by its button labels, so it keeps its own look.
  return path === 'wallet-check' ? (
    <div className="wallet-check">
      <WalletCheck />
    </div>
  ) : (
    <ErrorBoundary>
      <ZkApp path={path} />
    </ErrorBoundary>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
