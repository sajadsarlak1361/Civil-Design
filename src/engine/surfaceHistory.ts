/** Surface edits sit beside drawing checkpoints. The kind stack in editHistory decides which one Ctrl+Z hits. */

import { noteEdit, onEditHistoryClear } from './editHistory';
import type { MeshSectionState, SurfaceRecord } from './project';

export type SurfaceUndo =
  | { op: 'drop'; id: string; index: number; surface: SurfaceRecord }
  | { op: 'insert'; index: number; surface: SurfaceRecord }
  | { op: 'swap'; id: string; surface: SurfaceRecord }
  | { op: 'sections'; value: MeshSectionState | null };

const past: SurfaceUndo[] = [];
const future: SurfaceUndo[] = [];

onEditHistoryClear(() => {
  past.length = 0;
  future.length = 0;
});

export function recordSurfaceUndo(item: SurfaceUndo): void {
  past.push(item);
  if (past.length > 40) past.shift();
  future.length = 0;
  noteEdit('surface');
}

export function takeSurfaceUndo(): SurfaceUndo | null {
  return past.pop() ?? null;
}

export function takeSurfaceRedo(): SurfaceUndo | null {
  return future.pop() ?? null;
}

export function stashSurfaceUndo(item: SurfaceUndo): void {
  past.push(item);
}

export function stashSurfaceRedo(item: SurfaceUndo): void {
  future.push(item);
}
