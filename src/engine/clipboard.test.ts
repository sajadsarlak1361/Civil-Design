import { describe, expect, it } from 'vitest';
import { parseClipboard, pasteEntities, serializeClipboard, type ClipboardPayload } from './clipboard';
import type { DrawEntity } from './drafting';

const line: DrawEntity = {
  id: 'e1',
  type: 'line',
  layer: '0',
  color: 'bylayer',
  a: { x: 0, y: 0, z: 1 },
  b: { x: 10, y: 0, z: 1 },
};

function payload(base: ClipboardPayload['base'], link = false): ClipboardPayload {
  return { format: 'fieldline-clipboard', version: 1, base, link, entities: [structuredClone(line)] };
}

describe('clipboard serialization', () => {
  it('round-trips entity data and ignores plain text', () => {
    const text = serializeClipboard(payload({ x: 10, y: 0, z: 1 }));
    expect(parseClipboard(text)?.entities[0]).toMatchObject({ type: 'line', a: line.a, b: line.b });
    expect(parseClipboard('just a note')).toBeNull();
    expect(parseClipboard('{"format":"other"}')).toBeNull();
  });

  it('keeps a copy-link prefix in front of the JSON', () => {
    const text = serializeClipboard(payload(null, true));
    expect(text.startsWith('fieldline://clipboard\n')).toBe(true);
    expect(parseClipboard(text)?.link).toBe(true);
    expect(parseClipboard(text)?.entities).toHaveLength(1);
  });
});

describe('paste placement', () => {
  let n = 0;
  const id = () => `n${(n += 1)}`;

  it('uses the COPYBASE base point', () => {
    const placed = pasteEntities(payload({ x: 10, y: 0, z: 1 }), 'point', { x: 0, y: 5, z: 1 }, id);
    expect(placed.entities[0]).toMatchObject({ a: { x: -10, y: 5, z: 1 }, b: { x: 0, y: 5, z: 1 } });
  });

  it('pastes to the original coordinates', () => {
    const placed = pasteEntities(payload({ x: 10, y: 0, z: 1 }), 'original', { x: 99, y: 99, z: 9 }, id);
    expect(placed.entities[0]).toMatchObject({ a: { x: 0, y: 0, z: 1 }, b: { x: 10, y: 0, z: 1 } });
    expect(placed.block).toBeUndefined();
  });

  it('paste as block remembers the definition and places a translated copy', () => {
    const placed = pasteEntities(payload({ x: 0, y: 0, z: 1 }), 'block', { x: 5, y: 0, z: 1 }, id);
    expect(placed.block?.name).toMatch(/^Block/);
    expect(placed.block?.entities[0]).toMatchObject({ a: { x: 0, y: 0, z: 1 } });
    expect(placed.entities[0]).toMatchObject({ a: { x: 5, y: 0, z: 1 }, b: { x: 15, y: 0, z: 1 } });
  });
});
