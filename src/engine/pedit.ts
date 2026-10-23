import { arcSweep, pointOnArc, type DrawArc, type DrawEntity, type DrawPolyline, type PolyVertex, type Vec3 } from './drafting';

const EPS = 1e-6;

function vert(point: Vec3, bulge = 0): PolyVertex {
  return { x: point.x, y: point.y, z: point.z, bulge };
}

function near(a: { x: number; y: number }, b: { x: number; y: number }, fuzz: number): boolean {
  return Math.hypot(a.x - b.x, a.y - b.y) <= Math.max(fuzz, EPS);
}

/** Reverse vertex order and move each bulge onto the segment that still owns it. */
export function reversePolyline(vertices: PolyVertex[], closed = false): PolyVertex[] {
  const copy = vertices.map((vertex) => ({ ...vertex }));
  copy.reverse();
  const count = copy.length;
  const transfer = (target: PolyVertex, source: PolyVertex | undefined, negateBulge: number) => {
    target.bulge = negateBulge;
    if (!source || (source.startWidth == null && source.endWidth == null)) return;
    target.startWidth = source.endWidth;
    target.endWidth = source.startWidth;
  };
  for (let i = 0; i < count - 1; i++) {
    const source = vertices[count - 2 - i];
    transfer(copy[i], source, -(source?.bulge ?? 0));
  }
  if (count > 0) {
    const source = vertices[count - 1];
    transfer(copy[count - 1], closed ? source : undefined, closed ? -(source?.bulge ?? 0) : 0);
  }
  return copy;
}

/** Line, arc, or polyline as an open or closed vertex chain. */
export function entityChain(entity: DrawEntity): { vertices: PolyVertex[]; closed: boolean } | null {
  if (entity.type === 'polyline') return { vertices: entity.vertices.map((vertex) => ({ ...vertex })), closed: entity.closed };
  if (entity.type === 'line') return { vertices: [vert(entity.a), vert(entity.b)], closed: false };
  if (entity.type === 'arc') return { vertices: arcVertices(entity), closed: false };
  return null;
}

function arcVertices(arc: DrawArc): PolyVertex[] {
  const start = pointOnArc(arc, 0);
  const end = pointOnArc(arc, 1);
  return [vert(start, Math.tan(arcSweep(arc) / 4)), vert(end)];
}

export interface JoinChain {
  id: string;
  vertices: PolyVertex[];
  closed: boolean;
}

export interface JoinResult {
  vertices: PolyVertex[];
  closed: boolean;
  consumed: string[];
}

/**
 * PEDIT Join. Open chains whose endpoints lie within `fuzz` are appended.
 * A chain that meets both ends closes the polyline. Closed candidates are skipped.
 */
export function joinChains(base: PolyVertex[], closed: boolean, others: JoinChain[], fuzz: number): JoinResult {
  if (closed) return { vertices: base.map((vertex) => ({ ...vertex })), closed: true, consumed: [] };
  let verts = base.map((vertex) => ({ ...vertex }));
  const pool = others.filter((chain) => !chain.closed && chain.vertices.length >= 2).map((chain) => ({
    id: chain.id,
    vertices: chain.vertices.map((vertex) => ({ ...vertex })),
  }));
  const consumed: string[] = [];
  let guard = 0;
  while (guard < pool.length + 4) {
    guard += 1;
    if (verts.length >= 3 && near(verts[0], verts[verts.length - 1], fuzz)) {
      return { vertices: verts.slice(0, -1), closed: true, consumed };
    }
    const start = verts[0];
    const end = verts[verts.length - 1];
    let found = -1;
    let atEnd = true;
    for (let i = 0; i < pool.length; i++) {
      const chain = pool[i].vertices;
      const head = chain[0];
      const tail = chain[chain.length - 1];
      if (near(end, head, fuzz) || near(end, tail, fuzz)) {
        found = i;
        atEnd = true;
        break;
      }
      if (near(start, head, fuzz) || near(start, tail, fuzz)) {
        found = i;
        atEnd = false;
        break;
      }
    }
    if (found < 0) break;
    const item = pool.splice(found, 1)[0];
    let chain = item.vertices;
    const anchor = atEnd ? end : start;
    const head = chain[0];
    const tail = chain[chain.length - 1];
    const touchHead = near(anchor, head, fuzz);
    const touchTail = near(anchor, tail, fuzz);
    // The junction vertex is dropped. Append wants it at the head; prepend wants it at the tail.
    if (atEnd) {
      if (touchTail && !touchHead) chain = reversePolyline(chain);
    } else if (touchHead && !touchTail) chain = reversePolyline(chain);
    if (atEnd) {
      chain = chain.map((vertex, index) => (index === 0 ? { ...vertex, x: anchor.x, y: anchor.y, z: anchor.z } : { ...vertex }));
      verts = [...verts, ...chain.slice(1)];
    } else {
      const last = chain.length - 1;
      chain = chain.map((vertex, index) => (index === last ? { ...vertex, x: anchor.x, y: anchor.y, z: anchor.z } : { ...vertex }));
      verts = [...chain.slice(0, -1), ...verts];
    }
    consumed.push(item.id);
  }
  const meets = verts.length >= 3 && near(verts[0], verts[verts.length - 1], fuzz);
  return { vertices: meets ? verts.slice(0, -1) : verts, closed: meets, consumed };
}

function wrap(angle: number): number {
  let value = angle;
  while (value > Math.PI) value -= Math.PI * 2;
  while (value < -Math.PI) value += Math.PI * 2;
  return value;
}

/**
 * Fit curve through the vertices. Each segment bulge follows the tangent at its
 * start vertex, which is the average of the adjacent chord directions.
 */
export function fitPolyline(vertices: PolyVertex[], closed: boolean, tangents?: readonly (number | null)[]): PolyVertex[] {
  const count = vertices.length;
  if (count < 2) return vertices.map((vertex) => ({ ...vertex, bulge: 0 }));
  const tangentAt = (index: number): number => {
    const given = tangents?.[index];
    if (typeof given === 'number' && Number.isFinite(given)) return given;
    const curr = vertices[index];
    const prev = vertices[(index - 1 + count) % count];
    const next = vertices[(index + 1) % count];
    const hasPrev = closed || index > 0;
    const hasNext = closed || index < count - 1;
    if (hasPrev && hasNext) {
      const inx = curr.x - prev.x;
      const iny = curr.y - prev.y;
      const outx = next.x - curr.x;
      const outy = next.y - curr.y;
      const il = Math.hypot(inx, iny) || 1;
      const ol = Math.hypot(outx, outy) || 1;
      return Math.atan2(iny / il + outy / ol, inx / il + outx / ol);
    }
    if (!closed && index === 0 && count >= 3) {
      const chord = Math.atan2(vertices[1].y - curr.y, vertices[1].x - curr.x);
      const far = Math.atan2(vertices[2].y - curr.y, vertices[2].x - curr.x);
      return chord + wrap(far - chord) * 0.5;
    }
    if (!closed && index === count - 1 && count >= 3) {
      const chord = Math.atan2(curr.y - vertices[count - 2].y, curr.x - vertices[count - 2].x);
      const far = Math.atan2(curr.y - vertices[count - 3].y, curr.x - vertices[count - 3].x);
      return chord + wrap(far - chord) * 0.5;
    }
    const other = hasNext ? next : prev;
    return Math.atan2(other.y - curr.y, other.x - curr.x);
  };
  return vertices.map((vertex, index) => {
    if (!closed && index === count - 1) return { ...vertex, bulge: 0 };
    const next = vertices[(index + 1) % count];
    const chord = Math.atan2(next.y - vertex.y, next.x - vertex.x);
    const alpha = Math.max(-2.4, Math.min(2.4, wrap(tangentAt(index) - chord)));
    return { ...vertex, bulge: Math.tan(alpha / 2) };
  });
}

export function moveVertex(vertices: PolyVertex[], index: number, point: Vec3): PolyVertex[] {
  return vertices.map((vertex, i) => (i === index ? { ...vertex, x: point.x, y: point.y, z: point.z } : { ...vertex }));
}

export function insertVertex(vertices: PolyVertex[], index: number, point: Vec3): PolyVertex[] {
  const next = vertices.map((vertex) => ({ ...vertex }));
  next.splice(Math.min(index + 1, next.length), 0, vert(point));
  return next;
}

export function setSegmentWidth(vertices: PolyVertex[], index: number, startWidth: number, endWidth: number): PolyVertex[] {
  return vertices.map((vertex, i) => (i === index ? { ...vertex, startWidth, endWidth } : { ...vertex }));
}

/** Drop vertices strictly between the two indexes and straighten that span. */
export function straightenRange(vertices: PolyVertex[], from: number, to: number): PolyVertex[] {
  const start = Math.min(from, to);
  const end = Math.max(from, to);
  const next = [...vertices.slice(0, start + 1).map((vertex) => ({ ...vertex })), ...vertices.slice(end).map((vertex) => ({ ...vertex }))];
  if (next[start]) next[start] = { ...next[start], bulge: 0 };
  return next;
}

export interface PolyBreak {
  primary: PolyVertex[];
  /** Second open polyline. Null when a closed polyline is only opened. */
  extra: PolyVertex[] | null;
  closed: boolean;
}

/** Break the span between two vertices. Equal indexes split an open polyline at that vertex. */
export function breakPolylineAt(vertices: PolyVertex[], from: number, to: number, closed: boolean): PolyBreak | null {
  const count = vertices.length;
  if (count < 2) return null;
  const start = Math.min(from, to);
  const end = Math.max(from, to);
  if (closed) {
    const rotated = [...vertices.slice(end), ...vertices.slice(0, end)].map((vertex) => ({ ...vertex }));
    const span = (start - end + count) % count;
    if (span === 0) return { primary: rotated, extra: null, closed: false };
    const primary = rotated.slice(0, count - span).map((vertex) => ({ ...vertex }));
    const extra = rotated.slice(count - span).map((vertex) => ({ ...vertex }));
    if (primary.length > 0) primary[primary.length - 1] = { ...primary[primary.length - 1], bulge: 0 };
    return { primary, extra: extra.length >= 2 ? extra : null, closed: false };
  }
  if (start <= 0 && end >= count - 1) return null;
  if (start === end) {
    if (start <= 0 || start >= count - 1) return null;
    return {
      primary: vertices.slice(0, start + 1).map((vertex, index) => ({ ...vertex, bulge: index === start ? 0 : vertex.bulge })),
      extra: vertices.slice(start).map((vertex) => ({ ...vertex })),
      closed: false,
    };
  }
  const primary = [...vertices.slice(0, start + 1), ...vertices.slice(end)].map((vertex) => ({ ...vertex }));
  if (primary[start]) primary[start] = { ...primary[start], bulge: 0 };
  const removed = vertices.slice(start, end + 1).map((vertex) => ({ ...vertex }));
  return { primary, extra: removed.length >= 2 ? removed : null, closed: false };
}

export function zeroBulges(vertices: PolyVertex[]): PolyVertex[] {
  return vertices.map((vertex) => ({ ...vertex, bulge: 0 }));
}

export function asPolyline(source: DrawEntity, chain: { vertices: PolyVertex[]; closed: boolean }): DrawPolyline {
  return {
    id: source.id,
    type: 'polyline',
    layer: source.layer,
    color: source.color,
    vertices: chain.vertices,
    closed: chain.closed,
  };
}
