export interface ShpFeature {
  type: 'point' | 'polyline' | 'polygon';
  points: { x: number; y: number }[];
}

const SHAPE: Record<ShpFeature['type'], number> = { point: 1, polyline: 3, polygon: 5 };

function boxOf(points: { x: number; y: number }[]) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  if (!Number.isFinite(minX)) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  return { minX, minY, maxX, maxY };
}

export function writeShp(features: ShpFeature[]): Uint8Array {
  const records: Uint8Array[] = [];
  let words = 50;
  const all: { x: number; y: number }[] = [];
  features.forEach((feature, index) => {
    const points = feature.type === 'polygon' ? closeRing(feature.points) : feature.points;
    all.push(...points);
    const content = feature.type === 'point' ? 20 : 44 + 4 + points.length * 16;
    const record = new Uint8Array(8 + content);
    const view = new DataView(record.buffer);
    view.setInt32(0, index + 1, false);
    view.setInt32(4, content / 2, false);
    view.setInt32(8, SHAPE[feature.type], true);
    if (feature.type === 'point') {
      view.setFloat64(12, points[0]?.x ?? 0, true);
      view.setFloat64(20, points[0]?.y ?? 0, true);
    } else {
      const box = boxOf(points);
      view.setFloat64(12, box.minX, true);
      view.setFloat64(20, box.minY, true);
      view.setFloat64(28, box.maxX, true);
      view.setFloat64(36, box.maxY, true);
      view.setInt32(44, 1, true);
      view.setInt32(48, points.length, true);
      view.setInt32(52, 0, true);
      points.forEach((point, pointIndex) => {
        view.setFloat64(56 + pointIndex * 16, point.x, true);
        view.setFloat64(64 + pointIndex * 16, point.y, true);
      });
    }
    words += record.length / 2;
    records.push(record);
  });
  const file = new Uint8Array(words * 2);
  const view = new DataView(file.buffer);
  view.setInt32(0, 9994, false);
  view.setInt32(24, words, false);
  view.setInt32(28, 1000, true);
  const kind = features.length === 0 ? 0 : SHAPE[features[0].type];
  view.setInt32(32, features.every((feature) => SHAPE[feature.type] === kind) ? kind : 0, true);
  const box = boxOf(all);
  view.setFloat64(36, box.minX, true);
  view.setFloat64(44, box.minY, true);
  view.setFloat64(52, box.maxX, true);
  view.setFloat64(60, box.maxY, true);
  let offset = 100;
  for (const record of records) {
    file.set(record, offset);
    offset += record.length;
  }
  return file;
}

function closeRing(points: { x: number; y: number }[]): { x: number; y: number }[] {
  if (points.length === 0) return points;
  const first = points[0];
  const last = points[points.length - 1];
  if (first.x === last.x && first.y === last.y) return points;
  return [...points, { ...first }];
}

export function looksLikeShp(bytes: Uint8Array): boolean {
  if (bytes.length < 100) return false;
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getInt32(0, false) === 9994;
}

export function readShp(bytes: Uint8Array): ShpFeature[] {
  if (!looksLikeShp(bytes)) throw new Error('Not a shapefile.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const features: ShpFeature[] = [];
  let offset = 100;
  while (offset + 12 <= bytes.length) {
    const contentWords = view.getInt32(offset + 4, false);
    const content = contentWords * 2;
    const type = view.getInt32(offset + 8, true);
    if (type === 1) {
      features.push({ type: 'point', points: [{ x: view.getFloat64(offset + 12, true), y: view.getFloat64(offset + 20, true) }] });
    } else if (type === 3 || type === 5) {
      const parts = view.getInt32(offset + 44, true);
      const count = view.getInt32(offset + 48, true);
      const points: { x: number; y: number }[] = [];
      const start = offset + 52 + parts * 4;
      for (let index = 0; index < count; index += 1) {
        points.push({ x: view.getFloat64(start + index * 16, true), y: view.getFloat64(start + index * 16 + 8, true) });
      }
      features.push({ type: type === 5 ? 'polygon' : 'polyline', points });
    }
    offset += 8 + content;
  }
  return features;
}
