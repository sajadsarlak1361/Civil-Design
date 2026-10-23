import { entityPath, moved, type DrawEntity, type Vec3 } from './drafting';

/**
 * Clipboard payload shared by every Civil Design window.
 * The same JSON is written as plain text and, where the browser allows it,
 * as `web application/x-fieldline-clipboard`. A second tab or the desktop
 * shell can paste it back into entities. Plain text that is not this payload
 * is ignored.
 *
 * Block definitions produced by PASTEBLOCK live here so the block/group work
 * can pick them up without another copy of the geometry.
 */
export const CLIPBOARD_FORMAT = 'fieldline-clipboard';
export const CLIPBOARD_MIME = 'web application/x-fieldline-clipboard';

export interface ClipboardPayload {
  format: typeof CLIPBOARD_FORMAT;
  version: 1;
  /** COPYBASE base. Null means PASTECLIP uses the selection's lower-left. */
  base: Vec3 | null;
  /** COPYLINK also carries a fieldline link line in the text form. */
  link: boolean;
  entities: DrawEntity[];
}

export interface BlockDefinition {
  name: string;
  base: Vec3;
  entities: DrawEntity[];
}

export interface PasteResult {
  entities: DrawEntity[];
  block?: BlockDefinition;
}

let memory: ClipboardPayload | null = null;
let blockSerial = 1;
const blocks: BlockDefinition[] = [];

export function rememberClipboard(payload: ClipboardPayload): void {
  memory = payload;
}

export function rememberedClipboard(): ClipboardPayload | null {
  return memory;
}

/** Base point stored by the last COPYBASE, if any. */
export function activeClipboardBase(): Vec3 | null {
  return memory?.base ?? null;
}

export function blockDefinitions(): readonly BlockDefinition[] {
  return blocks;
}

export function serializeClipboard(payload: ClipboardPayload): string {
  const body = JSON.stringify(payload);
  return payload.link ? `fieldline://clipboard\n${body}` : body;
}

export function parseClipboard(text: string): ClipboardPayload | null {
  const raw = text.trim();
  const json = raw.startsWith('fieldline://clipboard') ? raw.slice(raw.indexOf('\n') + 1) : raw;
  try {
    const data = JSON.parse(json) as Partial<ClipboardPayload>;
    if (data.format !== CLIPBOARD_FORMAT || data.version !== 1 || !Array.isArray(data.entities)) return null;
    return {
      format: CLIPBOARD_FORMAT,
      version: 1,
      base: data.base && Number.isFinite(data.base.x) && Number.isFinite(data.base.y) ? { x: data.base.x, y: data.base.y, z: Number.isFinite(data.base.z) ? data.base.z : 0 } : null,
      link: Boolean(data.link),
      entities: data.entities,
    };
  } catch {
    return null;
  }
}

export function boundsBase(entities: DrawEntity[]): Vec3 {
  let minX = Infinity;
  let minY = Infinity;
  let z = 0;
  const visit = (p: Vec3) => {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    z = p.z;
  };
  for (const entity of entities) entityPath(entity, 8).forEach(visit);
  return { x: Number.isFinite(minX) ? minX : 0, y: Number.isFinite(minY) ? minY : 0, z };
}

/**
 * Place clipboard entities.
 * - point: move from the payload base (or the lower-left) to `at`
 * - original: keep stored coordinates (PASTEORIG)
 * - block: remember a block definition and place a translated copy (PASTEBLOCK)
 */
export function pasteEntities(payload: ClipboardPayload, mode: 'point' | 'original' | 'block', at: Vec3 | null, newId: () => string): PasteResult {
  const base = payload.base ?? boundsBase(payload.entities);
  const target = at ?? base;
  const dx = mode === 'original' ? 0 : target.x - base.x;
  const dy = mode === 'original' ? 0 : target.y - base.y;
  const dz = mode === 'original' ? 0 : target.z - base.z;
  const entities = payload.entities.map((entity) => {
    const copy = moved(structuredClone(entity), dx, dy, dz);
    copy.id = newId();
    return copy;
  });
  if (mode !== 'block') return { entities };
  const name = `Block${blockSerial}`;
  blockSerial += 1;
  const block: BlockDefinition = {
    name,
    base: { ...base },
    entities: payload.entities.map((entity) => structuredClone(entity)),
  };
  blocks.push(block);
  return { entities, block };
}
