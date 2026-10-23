import { OPEN_FILTERS, PROJECT_FILTERS, dialogPath, pathsFromDropPayload, type DialogFilter } from './openFiles';

interface TauriInternals {
  invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>;
  transformCallback?: (callback: (payload: unknown) => void, once?: boolean) => number;
}

function internals(): TauriInternals | null {
  if (typeof window === 'undefined') return null;
  const host = window as unknown as {
    __TAURI_INTERNALS__?: TauriInternals;
    __TAURI__?: { core?: { invoke?: TauriInternals['invoke'] }; invoke?: TauriInternals['invoke'] };
  };
  if (host.__TAURI_INTERNALS__?.invoke) return host.__TAURI_INTERNALS__;
  const legacy = host.__TAURI__;
  const invoke = legacy?.core?.invoke ?? legacy?.invoke;
  if (!invoke) return null;
  return { invoke };
}

export function desktopAvailable(): boolean {
  return internals() !== null;
}

export interface DesktopFile {
  name: string;
  path: string;
  bytes: Uint8Array;
}

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

async function readPath(path: string): Promise<DesktopFile> {
  const api = internals();
  if (!api) throw new Error('Desktop file access is not available.');
  const data = await api.invoke<string>('read_bytes', { path });
  const name = path.split(/[\\/]/).pop() || path;
  return { name, path, bytes: decode(data) };
}

export async function desktopReadPath(path: string): Promise<DesktopFile> {
  return readPath(path);
}

export async function desktopOpen(filters: DialogFilter[] = OPEN_FILTERS): Promise<DesktopFile | null> {
  const api = internals();
  if (!api) return null;
  const picked = await api.invoke<unknown>('plugin:dialog|open', {
    options: { title: 'Open', multiple: false, directory: false, filters },
  });
  const path = dialogPath(picked);
  if (!path) return null;
  return readPath(path);
}

export async function desktopSave(defaultPath: string, bytes: Uint8Array, filters: DialogFilter[] = PROJECT_FILTERS): Promise<'saved' | 'cancelled' | 'failed'> {
  const api = internals();
  if (!api) return 'failed';
  const picked = await api.invoke<unknown>('plugin:dialog|save', {
    options: {
      title: 'Save',
      defaultPath,
      filters,
    },
  });
  const path = dialogPath(picked);
  if (!path) return 'cancelled';
  await api.invoke('write_bytes', { path, data: encode(bytes) });
  return 'saved';
}

export async function desktopTakeLaunchPath(): Promise<string | null> {
  try {
    const api = internals();
    if (!api) return null;
    return dialogPath(await api.invoke<unknown>('take_launch_path'));
  } catch {
    return null;
  }
}

function listen(api: TauriInternals, event: string, handler: number): void {
  void Promise.resolve(api.invoke('plugin:event|listen', { event, target: { kind: 'Any' }, handler })).catch(() => {});
}

function unlisten(api: TauriInternals, event: string, handler: number): void {
  try {
    void Promise.resolve(api.invoke('plugin:event|unlisten', { event, eventId: handler, handler })).catch(() => {});
  } catch {
    // Missing event plugin. The shell still has to stay mounted.
  }
}

export function onDesktopOpenPaths(handler: (paths: string[]) => void): () => void {
  try {
    const api = internals();
    if (!api?.transformCallback) return () => {};
    const id = api.transformCallback((payload) => {
      try {
        const paths = pathsFromDropPayload(payload);
        if (paths.length > 0) handler(paths);
      } catch {
        // A bad drop payload must not blank the window.
      }
    });
    listen(api, 'tauri://drag-drop', id);
    listen(api, 'fieldline-open-path', id);
    return () => {
      unlisten(api, 'tauri://drag-drop', id);
      unlisten(api, 'fieldline-open-path', id);
    };
  } catch {
    return () => {};
  }
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
  try {
    const api = internals();
    if (!api?.transformCallback) return () => {};
    const id = api.transformCallback((payload) => {
      try {
        const event = payload as { payload?: string };
        handler(typeof event?.payload === 'string' ? event.payload : '');
      } catch {
        // A bad xref event must not blank the window.
      }
    });
    listen(api, 'fieldline-xref-changed', id);
    return () => unlisten(api, 'fieldline-xref-changed', id);
  } catch {
    return () => {};
  }
}
