interface TauriInternals {
  invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>;
  transformCallback?: (callback: (payload: unknown) => void, once?: boolean) => number;
}

function internals(): TauriInternals | null {
  if (typeof window === 'undefined') return null;
  const host = window as unknown as { __TAURI_INTERNALS__?: TauriInternals };
  return host.__TAURI_INTERNALS__ ?? null;
}

export function desktopAvailable(): boolean {
  return internals() !== null;
}

export interface DesktopFile {
  name: string;
  path: string;
  bytes: Uint8Array;
}

const OPEN_FILTERS = [
  { name: 'Civil Design', extensions: ['fieldline', 'json'] },
  { name: 'Drawing', extensions: ['dxf', 'dwg', 'dwt'] },
  { name: 'Mesh', extensions: ['obj', 'stl', 'gltf'] },
  { name: 'LandXML', extensions: ['xml', 'landxml'] },
  { name: 'Points', extensions: ['csv', 'txt', 'xyz', 'asc'] },
  { name: 'Raster', extensions: ['tif', 'tiff', 'las', 'shp', 'png', 'jpg', 'jpeg'] },
];

function encode(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk));
  }
  return btoa(binary);
}

function decode(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export async function desktopOpen(): Promise<DesktopFile | null> {
  const api = internals();
  if (!api) return null;
  const picked = await api.invoke<string | string[] | null>('plugin:dialog|open', {
    options: { title: 'Open', multiple: false, directory: false, filters: OPEN_FILTERS },
  });
  const path = Array.isArray(picked) ? picked[0] : picked;
  if (!path) return null;
  const data = await api.invoke<string>('read_bytes', { path });
  const name = path.split(/[\\/]/).pop() || path;
  return { name, path, bytes: decode(data) };
}

export async function desktopSave(defaultPath: string, bytes: Uint8Array): Promise<'saved' | 'cancelled' | 'failed'> {
  const api = internals();
  if (!api) return 'failed';
  const path = await api.invoke<string | null>('plugin:dialog|save', {
    options: {
      title: 'Save',
      defaultPath,
      filters: [{ name: 'Civil Design', extensions: ['fieldline'] }],
    },
  });
  if (!path) return 'cancelled';
  await api.invoke('write_bytes', { path, data: encode(bytes) });
  return 'saved';
}

export async function desktopWatch(path: string): Promise<void> {
  const api = internals();
  if (!api || !path) return;
  await api.invoke('watch_xref', { path });
}

export async function desktopOpenPath(path: string): Promise<void> {
  const api = internals();
  if (!api) return;
  await api.invoke('open_path', { path });
}

export function onDesktopXrefChanged(handler: (path: string) => void): () => void {
  const api = internals();
  if (!api?.transformCallback) return () => {};
  const id = api.transformCallback((payload) => {
    const event = payload as { payload?: string };
    handler(typeof event?.payload === 'string' ? event.payload : '');
  });
  void api.invoke('plugin:event|listen', { event: 'fieldline-xref-changed', target: { kind: 'Any' }, handler: id });
  return () => {
    void api.invoke('plugin:event|unlisten', { event: 'fieldline-xref-changed', handler: id });
  };
}
