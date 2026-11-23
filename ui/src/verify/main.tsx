import { Buffer } from 'buffer';
// Midnight's browser bundles expect Node's Buffer as a global.
(globalThis as unknown as { Buffer: typeof Buffer }).Buffer = Buffer;

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../zk/ds.css';
import './verify.css';
import Verify from './Verify';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Verify />
  </StrictMode>,
);
