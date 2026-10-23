import { looksLikeLandXml } from '../landxml';
import { looksLikeAsc, xyzIsGrid } from './grid';
import { looksLikeLas, looksLikeLaz, LAZ_REASON } from './las';
import { looksLikeShp } from './shp';
import { readImageInfo } from './image';

export type IngestKind =
  | 'project'
  | 'points'
  | 'landxml'
  | 'dxf'
  | 'las'
  | 'dem'
  | 'xyz-grid'
  | 'geotiff'
  | 'shp'
  | 'image'
  | 'dwg'
  | 'laz'
  | 'obj'
  | 'stl'
  | 'gltf'
  | 'unknown';

const TEXT_EXT = /\.(csv|txt|xyz|asc|xml|landxml|dxf|json|fieldline)$/i;

function isTiff(bytes: Uint8Array): boolean {
  if (bytes.length < 4) return false;
  const little = bytes[0] === 0x49 && bytes[1] === 0x49 && bytes[2] === 42 && bytes[3] === 0;
  const big = bytes[0] === 0x4d && bytes[1] === 0x4d && bytes[2] === 0 && bytes[3] === 42;
  return little || big;
}

export function classifyFile(name: string, bytes: Uint8Array): { kind: IngestKind; reason?: string } {
  const lower = name.toLowerCase();
  if (lower.endsWith('.dwg') || lower.endsWith('.dwt')) return { kind: 'dwg' };
  if (lower.endsWith('.obj')) return { kind: 'obj' };
  if (lower.endsWith('.stl')) return { kind: 'stl' };
  if (lower.endsWith('.gltf')) return { kind: 'gltf' };
  if (looksLikeLaz(bytes, name)) return { kind: 'laz', reason: LAZ_REASON };
  if (looksLikeLas(bytes)) return { kind: 'las' };
  if (isTiff(bytes)) return { kind: 'geotiff' };
  if (readImageInfo(bytes)) return { kind: 'image' };
  if (looksLikeShp(bytes)) return { kind: 'shp' };
  const head = new TextDecoder().decode(bytes.subarray(0, Math.min(bytes.length, 22)));
  if (head.startsWith('AutoCAD Binary DXF')) return { kind: 'dxf' };
  if (!TEXT_EXT.test(lower) && bytes.length > 800 && bytes.some((byte) => byte === 0)) return { kind: 'unknown' };
  const text = new TextDecoder().decode(bytes.slice(0, Math.min(bytes.length, 4000)));
  if (text.includes('"fieldline-project"')) return { kind: 'project' };
  if (looksLikeLandXml(text)) return { kind: 'landxml' };
  if (/^\s*0\s*\r?\n\s*SECTION/i.test(text) || text.includes('ENTITIES')) return { kind: 'dxf' };
  if (looksLikeAsc(text) || lower.endsWith('.asc')) return { kind: 'dem' };
  if (lower.endsWith('.xyz')) return { kind: xyzIsGrid(text) ? 'xyz-grid' : 'points' };
  if (/\.(csv|txt|xyz)$/i.test(lower) || text.includes(',') || /\s+\d/.test(text)) return { kind: 'points' };
  return { kind: 'unknown' };
}
