import { createContext, useContext, useEffect, useRef } from 'react';
import type { DomainEvent } from '@devday/contracts';
export type EventListener = (event: DomainEvent) => void;
export const UserEventsContext = createContext<(listener: EventListener) => () => void>(
  () => () => {},
);
export function useUserEvent(listener: EventListener) {
  const subscribe = useContext(UserEventsContext);
  const current = useRef(listener);
  current.current = listener;
  useEffect(() => subscribe((event) => current.current(event)), [subscribe]);
}
