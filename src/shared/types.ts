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

export type ReplayRPC = {
  bun: RPCSchema<{
    requests: {
      "platform:info": { params: void; response: PlatformInfo };
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
      /** Emitted by the bun process when chokidar sees a new replay file. */
      "watcher:file": { path: string };
    };
  }>;
};
