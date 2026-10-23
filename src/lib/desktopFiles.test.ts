import { afterEach, describe, expect, it } from 'vitest';
import { desktopTakeLaunchPath, onDesktopOpenPaths, onDesktopXrefChanged } from './desktopFiles';

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
});
