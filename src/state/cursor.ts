import { useSyncExternalStore } from 'react';

export interface CursorReadout {
  x: number;
  y: number;
  z: number | null;
  slope: number | null;
  surface: string | null;
}

let current: CursorReadout | null = null;
const listeners = new Set<() => void>();

export function setPlanCursor(cursor: CursorReadout | null): void {
  current = cursor;
  for (const listener of listeners) listener();
}

export function usePlanCursor(): CursorReadout | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => current,
  );
}
