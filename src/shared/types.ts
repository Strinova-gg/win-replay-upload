import type { RPCSchema } from "electrobun/bun";

export type UploadStatus = "uploaded" | "already-uploaded" | "failed";

export interface LogEntry {
  status: UploadStatus;
  /** ISO timestamp */
  at: string;
  /** Optional error message when status === 'failed'. */
  error?: string;
  /** HTTP status code when applicable. */
  httpStatus?: number;
}

export interface PlatformInfo {
  platform: NodeJS.Platform;
  isWindows: boolean;
  defaultWatchDir: string;
}

export interface AppSettings {
  autoSyncEnabled: boolean;
  watchDir: string | null;
}

export interface AuthState {
  signedIn: boolean;
}

export type ReplayRPC = {
  bun: RPCSchema<{
    requests: {
      "platform:info": { params: void; response: PlatformInfo };
      "settings:get": { params: void; response: AppSettings };
      "settings:update": {
        params: Partial<AppSettings>;
        response: AppSettings;
      };
      "app:getClosePromptState": { params: void; response: { pending: boolean } };
      "app:quit": { params: void; response: { quitting: boolean } };
      "app:closeToTray": { params: void; response: { continuing: boolean } };
      "shell:openExternal": {
        params: { url: string };
        response: { opened: boolean };
      };
      "auth:setState": { params: AuthState; response: AuthState };
      "watcher:start": {
        params: { dir?: string };
        response: { watching: boolean; dir: string };
      };
      "watcher:stop": { params: void; response: { watching: boolean } };
      "watcher:scan": { params: { dir?: string }; response: string[] };
      "dialog:pickFolder": { params: void; response: string | null };
      "dialog:pickReplays": { params: void; response: string[] };
      "file:read": {
        params: { path: string };
        /** Base64-encoded bytes to keep RPC payloads JSON-friendly. */
        response: { base64: string };
      };
      "log:get": { params: void; response: Record<string, LogEntry> };
      "log:status": { params: { name: string }; response: LogEntry | null };
      "log:set": {
        params: { name: string; entry: LogEntry };
        response: LogEntry;
      };
      "log:clearFailed": { params: void; response: number };
      "log:export": { params: void; response: string | null };
    };
    messages: Record<string, never>;
  }>;
  webview: RPCSchema<{
    requests: Record<string, never>;
    messages: {
      "app:showClosePrompt": {};
      /** Emitted by the bun process when the OAuth loopback callback is received. */
      "auth:callback": { search: string; rawUrl: string };
      /** Emitted by the bun process when chokidar sees a new replay file. */
      "watcher:file": { path: string };
    };
  }>;
};
