import { afterEach, describe, expect, it } from 'vitest';
import { desktopOpen, desktopReadDxf, desktopTakeLaunchPath, onDesktopOpenPaths, onDesktopXrefChanged } from './desktopFiles';

const previous = globalThis.window;

afterEach(() => {
  if (previous === undefined) {
    delete (globalThis as { window?: unknown }).window;
  } else {
    globalThis.window = previous;
  }
});

describe('desktop startup', () => {
  it('does not throw when the Tauri bridge throws', async () => {
    globalThis.window = {
      __TAURI_INTERNALS__: {
        invoke() {
          throw new Error('invoke');
        },
        transformCallback() {
          throw new Error('transform');
        },
      },
    } as unknown as Window & typeof globalThis;
    const stopOpen = onDesktopOpenPaths(() => {});
    const stopXref = onDesktopXrefChanged(() => {});
    expect(() => stopOpen()).not.toThrow();
    expect(() => stopXref()).not.toThrow();
    await expect(desktopTakeLaunchPath()).resolves.toBeNull();
  });

  it('ignores a drag that is not a drop', () => {
    const opened: string[][] = [];
    globalThis.window = {
      __TAURI_INTERNALS__: {
        invoke() {
          return Promise.resolve(1);
        },
        transformCallback(callback: (payload: unknown) => void) {
          callback({ payload: { type: 'enter', paths: ['C:\\drawings\\site.dxf'] } });
          callback({ payload: { type: 'drop', paths: ['C:\\drawings\\site.dwg'] } });
          return 1;
        },
      },
    } as unknown as Window & typeof globalThis;
    onDesktopOpenPaths((paths) => opened.push(paths));
    expect(opened).toEqual([['C:\\drawings\\site.dwg']]);
  });

  it('leaves a large DXF for a part read instead of one base64 string', async () => {
    const commands: string[] = [];
    globalThis.window = {
      __TAURI_INTERNALS__: {
        invoke(command: string) {
          commands.push(command);
          if (command === 'plugin:dialog|open') return Promise.resolve('C:\\drawings\\big.dxf');
          if (command === 'file_size') return Promise.resolve(5_000_000);
          throw new Error(`unexpected ${command}`);
        },
      },
    } as unknown as Window & typeof globalThis;
    const file = await desktopOpen();
    expect(file).toMatchObject({ streamDxf: true, byteLength: 5_000_000 });
    expect(file?.bytes.byteLength).toBe(0);
    expect(commands).not.toContain('read_bytes');
  });

  it('parses a DXF from base64 slices', async () => {
    const text = '0\nSECTION\n2\nENTITIES\n0\nLINE\n8\nRoad\n10\n1\n20\n2\n30\n0\n11\n4\n21\n6\n31\n0\n0\nEOF\n';
    const bytes = new TextEncoder().encode(text);
    globalThis.window = {
      __TAURI_INTERNALS__: {
        invoke(_command: string, args?: { offset?: number; length?: number }) {
          const offset = args?.offset ?? 0;
          const length = args?.length ?? 0;
          const slice = bytes.subarray(offset, offset + length);
          let binary = '';
          for (const byte of slice) binary += String.fromCharCode(byte);
          return Promise.resolve(btoa(binary));
        },
      },
    } as unknown as Window & typeof globalThis;
    const model = await desktopReadDxf('C:\\drawings\\lines.dxf', bytes.byteLength);
    expect(model.bulk?.entityCount).toBe(1);
    expect(Array.from(model.bulk?.segments ?? [])).toEqual([1, 2, 4, 6]);
  });
});
