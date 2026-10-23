/** Extensions File > Open accepts in the browser and on the desktop. */
export const OPEN_EXTENSIONS = [
  'dxf',
  'dwg',
  'dwt',
  'fieldline',
  'json',
  'xml',
  'landxml',
  'csv',
  'txt',
  'xyz',
  'asc',
  'las',
  'shp',
  'tif',
  'tiff',
  'png',
  'jpg',
  'jpeg',
  'obj',
  'stl',
  'gltf',
] as const;

export type OpenExtension = (typeof OPEN_EXTENSIONS)[number];

/** `<input type="file" accept>` for the browser. The desktop dialog uses OPEN_FILTERS. */
export const OPEN_ACCEPT = OPEN_EXTENSIONS.map((extension) => `.${extension}`).join(',');

export interface DialogFilter {
  name: string;
  extensions: string[];
}

/**
 * Windows shows only the first filter until the user changes it.
 * That filter has to list DXF, DWG, and every other extension the page accepts.
 */
export const OPEN_FILTERS: DialogFilter[] = [
  { name: 'All supported', extensions: [...OPEN_EXTENSIONS] },
  { name: 'DXF', extensions: ['dxf'] },
  { name: 'DWG', extensions: ['dwg', 'dwt'] },
  { name: 'Civil Design', extensions: ['fieldline', 'json'] },
  { name: 'LandXML', extensions: ['xml', 'landxml'] },
  { name: 'Points', extensions: ['csv', 'txt', 'xyz', 'asc'] },
  { name: 'Mesh', extensions: ['obj', 'stl', 'gltf'] },
  { name: 'Raster', extensions: ['tif', 'tiff', 'las', 'shp', 'png', 'jpg', 'jpeg'] },
  { name: 'All files', extensions: ['*'] },
];

export const PROJECT_FILTERS: DialogFilter[] = [{ name: 'Civil Design', extensions: ['fieldline', 'json'] }];

export function saveFilters(extension: string): DialogFilter[] {
  const ext = extension.replace(/^\./, '').toLowerCase();
  if (ext === 'dwg' || ext === 'dwt') {
    return [
      { name: 'DWG', extensions: ['dwg'] },
      { name: 'DXF', extensions: ['dxf'] },
    ];
  }
  if (ext === 'dxf') {
    return [
      { name: 'DXF', extensions: ['dxf'] },
      { name: 'DWG', extensions: ['dwg'] },
    ];
  }
  return PROJECT_FILTERS;
}

function fileUrlToPath(value: string): string {
  if (!/^file:/i.test(value)) return value;
  try {
    const url = new URL(value);
    let path = decodeURIComponent(url.pathname);
    if (/^\/[A-Za-z]:/.test(path)) path = path.slice(1);
    return path.replace(/\//g, path.includes('\\') ? '\\' : '/');
  } catch {
    return value;
  }
}

/** Dialog plugin results are a path string, a file URL, or a tagged path object. */
export function dialogPath(value: unknown): string | null {
  if (typeof value === 'string') {
    const path = fileUrlToPath(value).trim();
    return path || null;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const path = dialogPath(item);
      if (path) return path;
    }
    return null;
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    for (const key of ['path', 'Path', 'url', 'Url']) {
      if (key in record) {
        const path = dialogPath(record[key]);
        if (path) return path;
      }
    }
  }
  return null;
}

function payloadBody(payload: unknown): unknown {
  if (payload && typeof payload === 'object' && 'payload' in payload) return (payload as { payload: unknown }).payload;
  return payload;
}

/** Tauri drag-drop and the open-path event. A bare path string is one file. */
export function pathsFromDropPayload(payload: unknown): string[] {
  const body = payloadBody(payload);
  if (typeof body === 'string') {
    const path = dialogPath(body);
    return path ? [path] : [];
  }
  if (!body || typeof body !== 'object') return [];
  const record = body as { paths?: unknown; type?: unknown };
  if (typeof record.type === 'string' && record.type !== 'drop') return [];
  const paths = record.paths;
  if (!Array.isArray(paths)) return [];
  return paths.map((item) => dialogPath(item)).filter((item): item is string => Boolean(item));
}
