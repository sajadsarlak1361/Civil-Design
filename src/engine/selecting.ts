import type { DrawEntity, DrawingDoc } from './drafting';

/** Text carried by an entity. Attributes and dimensions use the same field when they exist. */
export function entityText(entity: DrawEntity): string | null {
  if (entity.type === 'text') return entity.content;
  const extra = entity as DrawEntity & { content?: string };
  return typeof extra.content === 'string' ? extra.content : null;
}

export interface TextHit {
  id: string;
  content: string;
}

export function findText(doc: DrawingDoc, query: string, matchCase = false): TextHit[] {
  const needle = matchCase ? query : query.toLowerCase();
  if (!needle) return [];
  const hits: TextHit[] = [];
  for (const entity of doc.entities) {
    const content = entityText(entity);
    if (content === null) continue;
    const hay = matchCase ? content : content.toLowerCase();
    if (hay.includes(needle)) hits.push({ id: entity.id, content });
  }
  return hits;
}

export function replaceText(entities: DrawEntity[], query: string, replacement: string, matchCase = false): { entities: DrawEntity[]; count: number } {
  if (!query) return { entities, count: 0 };
  let count = 0;
  const next = entities.map((entity) => {
    const content = entityText(entity);
    if (content === null || entity.type !== 'text') return entity;
    const hay = matchCase ? content : content.toLowerCase();
    const needle = matchCase ? query : query.toLowerCase();
    if (!hay.includes(needle)) return entity;
    count += 1;
    const replaced = matchCase ? content.split(query).join(replacement) : content.replace(new RegExp(escapeRegExp(query), 'gi'), replacement);
    return { ...entity, content: replaced };
  });
  return { entities: next, count };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function selectAll(doc: DrawingDoc): string[] {
  return doc.entities.map((entity) => entity.id);
}

export interface QuickFilter {
  type?: string;
  layer?: string;
  color?: string;
}

export function quickSelect(doc: DrawingDoc, filter: QuickFilter): string[] {
  return doc.entities
    .filter((entity) => {
      if (filter.type && entity.type !== filter.type) return false;
      if (filter.layer && entity.layer.toLowerCase() !== filter.layer.toLowerCase()) return false;
      if (filter.color && entity.color.toLowerCase() !== filter.color.toLowerCase()) return false;
      return true;
    })
    .map((entity) => entity.id);
}

/** Same type and layer as the current selection. The default Select Similar. */
export function selectSimilar(doc: DrawingDoc, ids: string[]): string[] {
  const seeds = doc.entities.filter((entity) => ids.includes(entity.id));
  if (seeds.length === 0) return [];
  const keys = new Set(seeds.map((entity) => `${entity.type}|${entity.layer.toLowerCase()}`));
  return doc.entities.filter((entity) => keys.has(`${entity.type}|${entity.layer.toLowerCase()}`)).map((entity) => entity.id);
}
