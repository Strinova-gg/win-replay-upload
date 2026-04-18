import React from "react";
import ReactDOM from "react-dom/client";
import { ClerkProvider } from "@clerk/clerk-react";
import { Electroview } from "electrobun/view";
import type { ReplayRPC } from "../shared/types";
import type { LogEntry } from "../shared/types";
import { App } from "../ui/App";
import { setBridge, type ReplayBridge } from "../bridge/bridge";

const PUBLISHABLE_KEY = process.env.CLERK_PUBLISHABLE_KEY ?? "";

// File-event listeners registered by the renderer.
const fileListeners = new Set<(p: string) => void>();

const rpc = Electroview.defineRPC<ReplayRPC>({
  handlers: {
    requests: {},
    messages: {
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

if (!PUBLISHABLE_KEY) {
  root.render(
    <div style={{ padding: 24, fontFamily: "system-ui" }}>
      <h2>Missing Clerk publishable key</h2>
      <p>
        Set <code>CLERK_PUBLISHABLE_KEY</code> in <code>.env</code> (see{" "}
        <code>.env.example</code>) and rebuild.
      </p>
    </div>,
  );
} else {
  root.render(
    <React.StrictMode>
      <ClerkProvider
        publishableKey={PUBLISHABLE_KEY}
        allowedRedirectOrigins={[/^http:\/\/127\.0\.0\.1(:\d+)?$/, /^http:\/\/localhost(:\d+)?$/]}
      >
        <App />
      </ClerkProvider>
    </React.StrictMode>,
  );
}
