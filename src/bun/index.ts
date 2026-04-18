import { BrowserWindow, BrowserView, Utils, ApplicationMenu } from "electrobun/bun";
import { homedir } from "node:os";
import { join } from "node:path";
import { ReplayWatcher } from "./watcher";
import { uploadLog } from "./log";
import type { ReplayRPC } from "../shared/types";

function defaultWatchDir(): string {
  if (process.platform === "win32") {
    const localAppData =
      process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local");
    return join(localAppData, "Strinova", "Saved", "Demos");
  }
  return join(homedir(), "Strinova", "Saved", "Demos");
}

let watcher: ReplayWatcher | null = null;

const rpc = BrowserView.defineRPC<ReplayRPC>({
  maxRequestTime: 30_000,
  handlers: {
    requests: {
      "platform:info": () => ({
        platform: process.platform,
        isWindows: process.platform === "win32",
        defaultWatchDir: defaultWatchDir(),
      }),

      "watcher:start": async ({ dir }) => {
        if (process.platform !== "win32") {
          throw new Error("Folder watching is only supported on Windows.");
        }
        const target = dir ?? defaultWatchDir();
        await watcher?.stop();
        watcher = new ReplayWatcher(target, (filePath) => {
          win.webview.rpc?.send["watcher:file"]({ path: filePath });
        });
        await watcher.start();
        return { watching: true, dir: target };
      },

      "watcher:stop": async () => {
        await watcher?.stop();
        watcher = null;
        return { watching: false };
      },

      "watcher:scan": async ({ dir }) =>
        ReplayWatcher.scanOnce(dir ?? defaultWatchDir()),

      "dialog:pickFolder": async () => {
        const paths = await Utils.openFileDialog({
          startingFolder: defaultWatchDir(),
          allowedFileTypes: "*",
          canChooseFiles: false,
          canChooseDirectory: true,
          allowsMultipleSelection: false,
        });
        return paths?.[0] ?? null;
      },

      "dialog:pickReplays": async () => {
        const paths = await Utils.openFileDialog({
          startingFolder: defaultWatchDir(),
          allowedFileTypes: "replay",
          canChooseFiles: true,
          canChooseDirectory: false,
          allowsMultipleSelection: true,
        });
        return paths ?? [];
      },

      "file:read": async ({ path }) => {
        const bytes = await Bun.file(path).arrayBuffer();
        const base64 = Buffer.from(bytes).toString("base64");
        return { base64 };
      },

      "log:get": () => uploadLog.all(),
      "log:status": ({ name }) => uploadLog.statusOf(name),
      "log:set": ({ name, entry }) => {
        uploadLog.set(name, entry);
        return entry;
      },
      "log:clearFailed": () => uploadLog.clearFailed(),
      "log:export": async () => {
        const downloads = Utils.paths.downloads;
        const out = join(
          downloads,
          `replay-upload-log-${Date.now()}.json`,
        );
        await uploadLog.exportTo(out);
        return out;
      },
    },
    messages: {},
  },
});

// Serve the bundled view assets over http://127.0.0.1 so Clerk (which derives
// its `redirect_url` from `window.location.href`) sees a real http(s) origin.
// Loading the view via the `views://` custom scheme makes Clerk's FAPI reject
// every request with `invalid_url_scheme`.
const viewsDir = join(import.meta.dir, "..", "views", "mainview");
const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};
const viewServer = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(req) {
    const url = new URL(req.url);
    const rel = url.pathname === "/" ? "/index.html" : url.pathname;
    const filePath = join(viewsDir, rel);
    if (!filePath.startsWith(viewsDir)) {
      return new Response("Forbidden", { status: 403 });
    }
    const file = Bun.file(filePath);
    if (!(await file.exists())) {
      return new Response("Not Found", { status: 404 });
    }
    const ext = filePath.slice(filePath.lastIndexOf("."));
    return new Response(file, {
      headers: { "Content-Type": MIME[ext] ?? "application/octet-stream" },
    });
  },
});

const win = new BrowserWindow({
  title: "Strinova Replay Uploader",
  url: `http://127.0.0.1:${viewServer.port}/index.html`,
  frame: { width: 1100, height: 760, x: 200, y: 200 },
  rpc,
});

ApplicationMenu.setApplicationMenu([
  {
    submenu: [
      { label: "About Strinova Replay Uploader", role: "hide" },
      { type: "separator" },
      { label: "Hide", role: "hide" },
      { label: "Hide Others", role: "hideOthers" },
      { label: "Show All", role: "showAll" },
      { type: "separator" },
      { label: "Quit", role: "quit" },
    ],
  },
  {
    label: "Edit",
    submenu: [
      { role: "undo" },
      { role: "redo" },
      { type: "separator" },
      { role: "cut" },
      { role: "copy" },
      { role: "paste" },
      { role: "pasteAndMatchStyle" },
      { role: "delete" },
      { role: "selectAll" },
    ],
  },
  {
    label: "Window",
    submenu: [
      { role: "minimize" },
      { role: "zoom" },
      { type: "separator" },
      { role: "close" },
    ],
  },
]);
