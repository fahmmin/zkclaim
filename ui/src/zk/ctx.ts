// Service context, kept apart from the shell so hot reload never swaps it under the screens.
import { createContext, useContext, useSyncExternalStore } from 'react';
import type { ZkClaimService } from './service';

export const ServiceContext = createContext<ZkClaimService | null>(null);

export function useService(): ZkClaimService {
  const s = useContext(ServiceContext);
  if (!s) throw new Error('useService outside the app shell');
  return s;
}

export function useSnap() {
  const s = useService();
  return useSyncExternalStore(s.subscribe, s.snapshot);
}
