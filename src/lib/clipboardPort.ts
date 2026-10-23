/**
 * System clipboard used by COPYCLIP / PASTECLIP.
 * The browser port writes the Civil Design JSON as text/plain and, when the
 * platform accepts it, the custom MIME type. Tauri registers its own port
 * from the desktop host so two desktop windows share the OS clipboard.
 * Neither port is required for the in-memory clipboard inside one window.
 */
import { CLIPBOARD_MIME, parseClipboard, type ClipboardPayload, serializeClipboard } from '../engine/clipboard';

export interface ClipboardPort {
  writeText(text: string): Promise<void>;
  readText(): Promise<string>;
}

let port: ClipboardPort | null = null;

export function setClipboardPort(next: ClipboardPort | null): void {
  port = next;
}

export async function writeClipboardPayload(payload: ClipboardPayload): Promise<void> {
  const text = serializeClipboard(payload);
  if (port) {
    await port.writeText(text);
    return;
  }
  if (typeof navigator === 'undefined' || !navigator.clipboard) return;
  const clipboard = navigator.clipboard;
  if (clipboard.write && typeof ClipboardItem !== 'undefined') {
    try {
      const item = new ClipboardItem({
        'text/plain': new Blob([text], { type: 'text/plain' }),
        [CLIPBOARD_MIME]: new Blob([text], { type: CLIPBOARD_MIME }),
      });
      await clipboard.write([item]);
      return;
    } catch {
      // Custom MIME is refused by some browsers. Plain text still round-trips.
    }
  }
  if (clipboard.writeText) await clipboard.writeText(text);
}

export async function readClipboardPayload(): Promise<ClipboardPayload | null> {
  try {
    if (port) return parseClipboard(await port.readText());
    if (typeof navigator === 'undefined' || !navigator.clipboard?.readText) return null;
    return parseClipboard(await navigator.clipboard.readText());
  } catch {
    return null;
  }
}
