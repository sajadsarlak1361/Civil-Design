import { desktopAvailable } from './desktopFiles';
import { ODA_MISSING } from '../engine/formats/dwg';

export interface OdaProbe {
  found: boolean;
  path: string;
  message: string;
}

interface TauriInternals {
  invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>;
}

function internals(): TauriInternals | null {
  if (typeof window === 'undefined') return null;
  const host = window as unknown as { __TAURI_INTERNALS__?: TauriInternals };
  return host.__TAURI_INTERNALS__ ?? null;
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

export async function probeOda(custom: string): Promise<OdaProbe> {
  const api = internals();
  if (!api || !desktopAvailable()) return { found: false, path: '', message: ODA_MISSING };
  return api.invoke<OdaProbe>('oda_probe', { custom });
}

export async function convertOda(exe: string, name: string, bytes: Uint8Array, version: string, outputType: 'DWG' | 'DXF'): Promise<Uint8Array> {
  const api = internals();
  if (!api) throw new Error(ODA_MISSING);
  const data = await api.invoke<string>('oda_convert', { exe, name, data: encode(bytes), version, outputType });
  return decode(data);
}
