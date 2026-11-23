import { Buffer } from 'buffer';
// Midnight's browser bundles expect Node's Buffer as a global.
(globalThis as unknown as { Buffer: typeof Buffer }).Buffer = Buffer;

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './app.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
