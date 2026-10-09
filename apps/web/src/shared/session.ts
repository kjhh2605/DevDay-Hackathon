import { createContext, useContext } from 'react';
import type { User } from '@devday/contracts';
export const SessionContext = createContext<{ user: User | null }>({ user: null });
export function useSession() {
  return useContext(SessionContext);
}
