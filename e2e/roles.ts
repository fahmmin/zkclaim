// Where each role's 1AM test browser lives. One Chromium profile per role, so each role keeps its own 1AM wallet.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROLES = ['insurer', 'hospital', 'patient'] as const;
export type Role = (typeof ROLES)[number];

const here = path.dirname(fileURLToPath(import.meta.url));
export const extensionDir = path.join(here, '.extensions', '1am');
export const profileDir = (role: Role) => path.join(here, '.profiles', role);
/** DevTools port the tests attach to; the browser itself stays open between runs so the wallet stays unlocked. */
export const devtoolsPort = (role: Role) => 9331 + ROLES.indexOf(role);
export const DAPP_URL = process.env['DAPP_URL'] ?? 'http://localhost:5173';

export const parseRole = (arg: string | undefined): Role => {
  const role = (arg ?? 'insurer') as Role;
  if (!ROLES.includes(role)) throw new Error(`Role must be one of: ${ROLES.join(', ')}`);
  return role;
};
