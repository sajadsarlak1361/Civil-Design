import type { BlockDef, CadLibrary } from './cadLibrary';
import type { DrawAttDef, DrawInsert, InsertAttr, Xyz } from './cadShapes';
import { moved, type DrawEntity } from './drafting';
import { mapCadEntity } from './entityOps';

/** Block geometry in definition coordinates, with the base point at the origin. */
export function blockLocalEntities(block: BlockDef, parse: (value: object) => DrawEntity | null): DrawEntity[] {
  const out: DrawEntity[] = [];
  for (const raw of block.entities) {
    if (!raw || typeof raw !== 'object') continue;
    const entity = parse(raw);
    if (!entity) continue;
    out.push(moved(entity, -block.base.x, -block.base.y, -(block.base.z || 0)));
  }
  return out;
}

export function blockByName(library: CadLibrary, name: string): BlockDef | undefined {
  return library.blocks.find((block) => block.name.toLowerCase() === name.toLowerCase());
}

export function defineBlock(library: CadLibrary, name: string, base: Xyz, entities: DrawEntity[], description = ''): BlockDef {
  const existing = blockByName(library, name);
  const record: BlockDef = {
    name,
    base: { ...base },
    description,
    entities: entities.map((entity) => structuredClone(entity)),
  };
  if (existing) {
    existing.base = record.base;
    existing.description = record.description;
    existing.entities = record.entities;
    return existing;
  }
  library.blocks.push(record);
  return record;
}

export function insertAttributes(defs: DrawAttDef[], insert: Xyz, rotation: number, sx: number, sy: number): InsertAttr[] {
  return defs.map((def) => ({
    tag: def.tag,
    value: def.value,
    prompt: def.prompt,
    p: transformBlockPoint(def.p, { x: 0, y: 0, z: 0 }, insert, rotation, sx, sy),
    height: def.height * Math.abs(sy || 1),
    rotation: def.rotation + rotation,
    invisible: def.invisible,
    constant: def.constant,
  }));
}

export function transformBlockPoint(p: Xyz, base: Xyz, insert: Xyz, rotation: number, sx: number, sy: number): Xyz {
  const x = (p.x - base.x) * sx;
  const y = (p.y - base.y) * sy;
  const c = Math.cos(rotation);
  const s = Math.sin(rotation);
  return { x: insert.x + x * c - y * s, y: insert.y + x * s + y * c, z: insert.z + (p.z - base.z) };
}

/** World position of one instanced vertex. The block definition stays shared. */
export function instancePoint(block: BlockDef, insert: DrawInsert, point: Xyz): Xyz {
  return transformBlockPoint(point, block.base, insert.p, insert.rotation, insert.sx, insert.sy);
}

export function purgeLibrary(library: CadLibrary, used: Set<string>): string[] {
  const removed: string[] = [];
  library.blocks = library.blocks.filter((block) => {
    const keep = used.has(block.name.toLowerCase()) || block.name === '*Model_Space';
    if (!keep) removed.push(block.name);
    return keep;
  });
  const styles = new Set(library.dimStyles.map((style) => style.name.toLowerCase()));
  void styles;
  return removed;
}

export function explodeInsert(insert: DrawInsert, block: BlockDef, ids: () => string, parse: (value: object) => DrawEntity | null): DrawEntity[] {
  const out: DrawEntity[] = [];
  for (const raw of block.entities) {
    const entity = parse(raw);
    if (!entity) continue;
    const moved = translateEntity(entity, block.base, insert, ids);
    if (moved) out.push(moved);
  }
  for (const attr of insert.attributes) {
    if (attr.invisible) continue;
    out.push({
      id: ids(),
      type: 'text',
      layer: insert.layer,
      color: insert.color,
      p: attr.p,
      height: attr.height,
      rotation: attr.rotation,
      content: attr.value || attr.tag,
    });
  }
  return out;
}

function translateEntity(entity: DrawEntity, base: Xyz, insert: DrawInsert, ids: () => string): DrawEntity | null {
  const fn = (p: Xyz) => transformBlockPoint(p, base, insert.p, insert.rotation, insert.sx, insert.sy);
  const mapped = mapCadEntity(entity, fn, insert.sx);
  if (mapped) return { ...mapped, id: ids() };
  const copy = { ...structuredClone(entity), id: ids() };
  if (copy.type === 'line') return { ...copy, a: fn(copy.a), b: fn(copy.b) };
  if (copy.type === 'point' || copy.type === 'text' || copy.type === 'mtext' || copy.type === 'attdef') return { ...copy, p: fn(copy.p) };
  if (copy.type === 'circle' || copy.type === 'arc') return { ...copy, center: fn(copy.center), radius: copy.radius * Math.abs(insert.sx) };
  if (copy.type === 'polyline') return { ...copy, vertices: copy.vertices.map((vertex) => ({ ...fn(vertex), bulge: vertex.bulge })) };
  return { ...copy };
}

export function usedBlockNames(entities: DrawEntity[]): Set<string> {
  const names = new Set<string>();
  for (const entity of entities) {
    if (entity.type === 'insert') names.add(entity.name.toLowerCase());
  }
  return names;
}
