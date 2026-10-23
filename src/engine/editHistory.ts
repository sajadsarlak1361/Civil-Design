/** Order of drawing checkpoints and surface edits, so Ctrl+Z undoes whichever happened last. */

type EditKind = 'draw' | 'surface';

const past: EditKind[] = [];
const future: EditKind[] = [];
let onClear: (() => void) | null = null;

export function noteEdit(kind: EditKind): void {
  past.push(kind);
  if (past.length > 100) past.shift();
  future.length = 0;
}

export function takeUndo(): EditKind | null {
  const kind = past.pop();
  if (!kind) return null;
  future.push(kind);
  return kind;
}

export function takeRedo(): EditKind | null {
  const kind = future.pop();
  if (!kind) return null;
  past.push(kind);
  return kind;
}

/** A cancelled drawing command drops its checkpoint without a redo entry. */
export function dropLastDrawNote(): void {
  if (past[past.length - 1] === 'draw') past.pop();
}

export function onEditHistoryClear(listener: () => void): void {
  onClear = listener;
}

export function clearEditHistory(): void {
  past.length = 0;
  future.length = 0;
  onClear?.();
}
