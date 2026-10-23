/** Runtime factory for the bundled LibreDWG writer. */
export interface DwgWriteModule {
  cwrap(ident: string, returnType: string, argTypes: string[]): (...args: string[]) => number;
  FS: {
    writeFile(path: string, data: string | Uint8Array): void;
    readFile(path: string): Uint8Array;
    unlink(path: string): void;
    analyzePath(path: string, dontResolveLastLink?: boolean): { exists: boolean };
  };
}

export interface DwgWriteOptions {
  wasmBinary?: ArrayBuffer | Uint8Array;
  print?: (text: string) => void;
  printErr?: (text: string) => void;
}

declare function createDwgWrite(options?: DwgWriteOptions): Promise<DwgWriteModule>;

export default createDwgWrite;
