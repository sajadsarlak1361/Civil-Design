export function downloadBytes(filename: string, content: Uint8Array, mime = 'application/octet-stream'): void {
  downloadBlob(filename, new Blob([content], { type: mime }));
}

export function downloadText(filename: string, content: string, mime = 'text/plain;charset=utf-8'): void {
  downloadBlob(filename, new Blob([content], { type: mime }));
}

export interface BrowserSaveType {
  description: string;
  accept: Record<string, string[]>;
}

type SavePicker = (options: {
  suggestedName?: string;
  types?: BrowserSaveType[];
}) => Promise<{
  name: string;
  createWritable: () => Promise<{ write: (data: Uint8Array) => Promise<void>; close: () => Promise<void> }>;
}>;

/** Chromium save picker. `unavailable` means the caller should fall back to a download. */
export async function browserSave(
  suggestedName: string,
  types: BrowserSaveType[],
  body: (filename: string) => Uint8Array,
): Promise<'saved' | 'cancelled' | 'unavailable'> {
  const picker = (window as unknown as { showSaveFilePicker?: SavePicker }).showSaveFilePicker;
  if (typeof picker !== 'function') return 'unavailable';
  try {
    const handle = await picker({ suggestedName, types });
    const payload = body(handle.name);
    const writable = await handle.createWritable();
    await writable.write(payload);
    await writable.close();
    return 'saved';
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return 'cancelled';
    if (error instanceof DOMException) return 'unavailable';
    throw error;
  }
}

function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
