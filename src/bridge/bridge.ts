import type { AppSettings, AuthState, LogEntry, PlatformInfo } from "../shared/types";

export interface ReplayBridge {
  platform: () => Promise<PlatformInfo>;
  settings: {
    get: () => Promise<AppSettings>;
    update: (patch: Partial<AppSettings>) => Promise<AppSettings>;
  };
  app: {
    getClosePromptState: () => Promise<{ pending: boolean }>;
    quit: () => Promise<{ quitting: boolean }>;
    closeToTray: () => Promise<{ continuing: boolean }>;
    onShowClosePrompt: (cb: () => void) => () => void;
  };
  shell: {
    openExternal: (url: string) => Promise<{ opened: boolean }>;
  };
  auth: {
    onCallback: (cb: (payload: { search: string; rawUrl: string }) => void) => () => void;
    setSignedIn: (signedIn: boolean) => Promise<AuthState>;
  };
  watcher: {
    start: (dir?: string) => Promise<{ watching: boolean; dir: string }>;
    stop: () => Promise<{ watching: boolean }>;
    scan: (dir?: string) => Promise<string[]>;
    onFile: (cb: (path: string) => void) => () => void;
  };
  dialog: {
    pickFolder: () => Promise<string | null>;
    pickReplays: () => Promise<string[]>;
  };
  file: {
    read: (path: string) => Promise<ArrayBuffer>;
  };
  log: {
    all: () => Promise<Record<string, LogEntry>>;
    statusOf: (name: string) => Promise<LogEntry | null>;
    set: (name: string, entry: LogEntry) => Promise<LogEntry>;
    clearFailed: () => Promise<number>;
    export: () => Promise<string | null>;
  };
}

let _bridge: ReplayBridge | null = null;

export function setBridge(b: ReplayBridge): void {
  _bridge = b;
}

export function bridge(): ReplayBridge {
  if (!_bridge) throw new Error("Replay bridge not initialised");
  return _bridge;
}
