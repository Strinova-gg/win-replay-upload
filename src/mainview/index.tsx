import React from "react";
import ReactDOM from "react-dom/client";
import { Electroview } from "electrobun/view";
import { DesktopAuthProvider } from "../auth/oauth";
import type { ReplayRPC } from "../shared/types";
import type { LogEntry } from "../shared/types";
import {
  APP_OAUTH_CLIENT_ID,
  APP_OAUTH_ISSUER,
} from "../shared/appConfig";
import { App } from "../ui/App";
import { setBridge, type ReplayBridge } from "../bridge/bridge";

// File-event listeners registered by the renderer.
const fileListeners = new Set<(p: string) => void>();
const authCallbackListeners = new Set<(payload: { search: string; rawUrl: string }) => void>();
const closePromptListeners = new Set<() => void>();

const rpc = Electroview.defineRPC<ReplayRPC>({
  handlers: {
    requests: {},
    messages: {
      "app:showClosePrompt": () => {
        for (const cb of closePromptListeners) cb();
      },
      "auth:callback": (payload) => {
        for (const cb of authCallbackListeners) cb(payload);
      },
      "watcher:file": ({ path }) => {
        for (const cb of fileListeners) cb(path);
      },
    },
  },
});

const electroview = new Electroview({ rpc });
const erpc = electroview.rpc!;

function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

const bridge: ReplayBridge = {
  platform: () => erpc.request["platform:info"](),
  settings: {
    get: () => erpc.request["settings:get"](),
    update: (patch) => erpc.request["settings:update"](patch),
  },
  app: {
    getClosePromptState: () => erpc.request["app:getClosePromptState"](),
    quit: () => erpc.request["app:quit"](),
    closeToTray: () => erpc.request["app:closeToTray"](),
    onShowClosePrompt: (cb) => {
      closePromptListeners.add(cb);
      return () => {
        closePromptListeners.delete(cb);
      };
    },
  },
  shell: {
    openExternal: (url) => erpc.request["shell:openExternal"]({ url }),
  },
  auth: {
    onCallback: (cb) => {
      authCallbackListeners.add(cb);
      return () => {
        authCallbackListeners.delete(cb);
      };
    },
    setSignedIn: (signedIn) => erpc.request["auth:setState"]({ signedIn }),
  },
  watcher: {
    start: (dir) => erpc.request["watcher:start"]({ dir }),
    stop: () => erpc.request["watcher:stop"](),
    scan: (dir) => erpc.request["watcher:scan"]({ dir }),
    onFile: (cb) => {
      fileListeners.add(cb);
      return () => {
        fileListeners.delete(cb);
      };
    },
  },
  dialog: {
    pickFolder: () => erpc.request["dialog:pickFolder"](),
    pickReplays: () => erpc.request["dialog:pickReplays"](),
  },
  file: {
    read: async (path) => {
      const { base64 } = await erpc.request["file:read"]({ path });
      return base64ToArrayBuffer(base64);
    },
  },
  log: {
    all: () => erpc.request["log:get"](),
    statusOf: (name) => erpc.request["log:status"]({ name }),
    set: (name: string, entry: LogEntry) =>
      erpc.request["log:set"]({ name, entry }),
    clearFailed: () => erpc.request["log:clearFailed"](),
    export: () => erpc.request["log:export"](),
  },
};

setBridge(bridge);

const root = ReactDOM.createRoot(document.getElementById("root")!);

if (!APP_OAUTH_CLIENT_ID || !APP_OAUTH_ISSUER) {
  root.render(
    <div style={{ padding: 24, fontFamily: "system-ui" }}>
      <h2>Missing OAuth configuration</h2>
      <p>
        Set <code>CLERK_OAUTH_CLIENT_ID</code> and <code>CLERK_OAUTH_ISSUER</code> in{" "}
        <code>.env</code> (see <code>.env.example</code>) and rebuild.
      </p>
    </div>,
  );
} else {
  root.render(
    <React.StrictMode>
      <DesktopAuthProvider>
        <App />
      </DesktopAuthProvider>
    </React.StrictMode>,
  );
}
