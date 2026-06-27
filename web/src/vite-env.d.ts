/// <reference types="vite/client" />

interface Window {
  __TAURI_INTERNALS__?: unknown;
  __TAURI__?: {
    core: { invoke: (cmd: string, args?: unknown) => Promise<any> };
    event: { listen: (e: string, cb: (e: { payload: any }) => void) => Promise<() => void> };
  };
}
