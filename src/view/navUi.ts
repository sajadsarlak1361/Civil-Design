import { useSyncExternalStore } from 'react';
import { NAV_MENU } from './navigate';

export interface NavMenuPoint {
  x: number;
  y: number;
  items: readonly string[];
}

let menu: NavMenuPoint | null = null;
let drag: 'pan' | 'zoom' | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function openNavMenu(x: number, y: number, items: readonly string[] = NAV_MENU): void {
  menu = { x, y, items };
  emit();
}

export function closeNavMenu(): void {
  if (!menu) return;
  menu = null;
  emit();
}

export function setNavDrag(kind: 'pan' | 'zoom' | null): void {
  if (drag === kind) return;
  drag = kind;
  emit();
}

export function navDrag(): 'pan' | 'zoom' | null {
  return drag;
}

export function subscribeNavUi(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useNavMenu(): NavMenuPoint | null {
  return useSyncExternalStore(subscribeNavUi, () => menu, () => menu);
}

export function useNavDrag(): 'pan' | 'zoom' | null {
  return useSyncExternalStore(subscribeNavUi, () => drag, () => drag);
}
