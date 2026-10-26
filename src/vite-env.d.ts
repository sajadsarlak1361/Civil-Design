/// <reference types="vite/client" />

declare module '@mlightcad/libredwg-web/wasm/libredwg-web.wasm?url' {
  const url: string;
  export default url;
}

declare module '*.wasm?url' {
  const url: string;
  export default url;
}

export {};

declare global {
  interface ImportMetaEnv {
    readonly VITEST?: boolean;
  }
}
