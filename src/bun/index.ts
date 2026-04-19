import Electrobun, {
  ApplicationMenu,
  BrowserView,
  BrowserWindow,
  Tray,
  Utils,
} from "electrobun/bun";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ReplayRPC } from "../shared/types";
import {
  APP_OAUTH_CALLBACK_HOST,
  APP_OAUTH_CALLBACK_PATH,
  APP_OAUTH_CALLBACK_PORT,
  APP_OAUTH_CALLBACK_URL,
  APP_UI_HOME_URL,
} from "../shared/appConfig";
import { uploadLog } from "./log";
import { appSettings } from "./settings";
import { ReplayWatcher } from "./watcher";

function logCallbackEvent(message: string, detail?: string): void {
  console.info(
    detail ? `[oauth-callback] ${message}: ${detail}` : `[oauth-callback] ${message}`,
  );
}

function defaultWatchDir(): string {
  if (process.platform === "win32") {
    const localAppData =
      process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local");
    return join(localAppData, "Strinova", "Saved", "Demos");
  }
  return join(homedir(), "Strinova", "Saved", "Demos");
}

function buildBrowserCallbackResponse(rawUrl: string): string {
  const escapedUrl = rawUrl
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Authentication complete</title>
    <style>
      body {
        margin: 0;
        font-family: system-ui, sans-serif;
        background: #f4f4f1;
        color: #161616;
      }
      main {
        max-width: 680px;
        margin: 12vh auto;
        padding: 24px;
      }
      article {
        background: white;
        border: 1px solid #d9d7d0;
        border-radius: 14px;
        padding: 24px;
        box-shadow: 0 18px 45px rgba(0, 0, 0, 0.08);
      }
      code {
        display: block;
        margin-top: 16px;
        padding: 12px;
        border-radius: 10px;
        background: #f7f6f1;
        overflow-wrap: anywhere;
        font-size: 12px;
      }
      p {
        line-height: 1.5;
      }
    </style>
  </head>
  <body>
    <main>
      <article>
        <h1>Authentication complete</h1>
        <p>The callback reached the desktop app. You can return to Stringify Desktop.</p>
        <code>${escapedUrl}</code>
      </article>
    </main>
    <script>
      setTimeout(() => window.close(), 250);
    </script>
  </body>
</html>`;
}

let watcher: ReplayWatcher | null = null;
let callbackServer: Bun.Server<undefined> | null = null;
let pendingCallbackPayload: { search: string; rawUrl: string } | null = null;
let pendingClosePrompt = false;
let win: BrowserWindow<typeof rpc> | null = null;
let tray: Tray | null = null;
let allowExplicitQuit = false;
let keepRunningInTrayOnNextQuit = false;
let authState = { signedIn: false };

function trayIconPath(): string {
  return join(process.cwd(), "assets", "stringify.ico");
}

function shouldOfferTrayOnClose(): boolean {
  return (
    process.platform === "win32" &&
    tray?.visible === true &&
    authState.signedIn &&
    appSettings.get().autoSyncEnabled
  );
}

function notifyTrayMode(): void {
  Utils.showNotification({
    title: "Still syncing from the tray",
    body: "Use the tray icon to reopen the uploader or quit it completely.",
    silent: true,
  });
}

function createTrackedMainWindow(initialUrl: string): BrowserWindow<typeof rpc> {
  const window = createMainWindow(initialUrl);
  window.on("close", () => {
    if (win?.id === window.id) {
      win = null;
    }
  });
  return window;
}

function ensureMainWindow(): BrowserWindow<typeof rpc> {
  if (!win) {
    win = createTrackedMainWindow(APP_UI_HOME_URL);
    deliverPendingOAuthCallback();
  }

  return win;
}

function showMainWindow(): BrowserWindow<typeof rpc> {
  const window = ensureMainWindow();
  if (window.isMinimized()) {
    window.unminimize();
  }
  window.show();
  window.focus();
  return window;
}

function beginQuitFlow(): void {
  Utils.quit();
}

function requestQuit(): void {
  allowExplicitQuit = true;
  Utils.quit();
}

function closeWindowToTray(): void {
  const currentWindow = win;
  if (!currentWindow) {
    notifyTrayMode();
    return;
  }

  keepRunningInTrayOnNextQuit = true;
  setTimeout(() => {
    if (win?.id === currentWindow.id) {
      currentWindow.close();
    }
  }, 0);
}

function installTray(): void {
  if (tray) {
    return;
  }

  tray = new Tray({
    image: trayIconPath(),
    width: 16,
    height: 16,
  });

  tray.setMenu([
    {
      type: "normal",
      label: "Open Stringify Desktop",
      action: "open",
    },
    { type: "separator" },
    {
      type: "normal",
      label: "Quit",
      action: "quit",
    },
  ]);

  tray.on("tray-clicked", (event) => {
    const action = (event as { data?: { action?: string } }).data?.action;

    if (!action || action === "open") {
      showMainWindow();
      return;
    }

    if (action === "quit") {
      beginQuitFlow();
    }
  });
}

function deliverPendingOAuthCallback(attempt = 0): void {
  if (!pendingCallbackPayload || !win?.webview.rpc) {
    if (pendingCallbackPayload && attempt < 50) {
      setTimeout(() => {
        deliverPendingOAuthCallback(attempt + 1);
      }, 100);
    }
    return;
  }

  const payload = pendingCallbackPayload;
  pendingCallbackPayload = null;
  win.webview.rpc.send["auth:callback"](payload);
  logCallbackEvent("Delivered callback payload to renderer", payload.rawUrl);
}

function deliverPendingClosePrompt(attempt = 0): void {
  if (!pendingClosePrompt || !win?.webview.rpc) {
    if (pendingClosePrompt && attempt < 50) {
      setTimeout(() => {
        deliverPendingClosePrompt(attempt + 1);
      }, 100);
    }
    return;
  }

  win.webview.rpc.send["app:showClosePrompt"]({});
}

function showClosePrompt(): void {
  pendingClosePrompt = true;
  showMainWindow();
  deliverPendingClosePrompt();
}

function loadOAuthCallback(search: string, rawUrl: string): void {
  logCallbackEvent("Received localhost callback URL", rawUrl);
  pendingCallbackPayload = { search, rawUrl };

  showMainWindow();
  deliverPendingOAuthCallback();
}

async function stopActiveWatcher(): Promise<void> {
  await watcher?.stop();
  watcher = null;
}

function startOAuthCallbackServer(): void {
  if (callbackServer) {
    return;
  }

  logCallbackEvent("Starting localhost callback server", APP_OAUTH_CALLBACK_URL);

  try {
    callbackServer = Bun.serve({
      hostname: APP_OAUTH_CALLBACK_HOST,
      port: APP_OAUTH_CALLBACK_PORT,
      fetch(request) {
        const url = new URL(request.url);

        if (url.pathname === APP_OAUTH_CALLBACK_PATH) {
          loadOAuthCallback(url.search, url.href);
          return new Response(buildBrowserCallbackResponse(url.href), {
            headers: {
              "cache-control": "no-store",
              "content-type": "text/html; charset=utf-8",
            },
          });
        }

        if (url.pathname === "/health") {
          return Response.json({
            ok: true,
            callbackUrl: APP_OAUTH_CALLBACK_URL,
          });
        }

        return new Response("Not found", { status: 404 });
      },
      error(error) {
        console.error("[oauth-callback] Loopback callback server error:", error);
        return new Response("Internal Server Error", { status: 500 });
      },
    });
  } catch (error) {
    console.error(
      `[oauth-callback] Failed to start localhost callback server on ${APP_OAUTH_CALLBACK_URL}:`,
      error,
    );
  }
}

const rpc = BrowserView.defineRPC<ReplayRPC>({
  maxRequestTime: 30_000,
  handlers: {
    requests: {
      "platform:info": () => ({
        platform: process.platform,
        isWindows: process.platform === "win32",
        defaultWatchDir: defaultWatchDir(),
      }),

      "settings:get": () => appSettings.get(),

      "settings:update": ({ autoSyncEnabled, watchDir }) =>
        appSettings.set({
          ...(typeof autoSyncEnabled === "boolean" ? { autoSyncEnabled } : {}),
          ...(typeof watchDir === "string" || watchDir === null ? { watchDir } : {}),
        }),

      "app:getClosePromptState": () => ({
        pending: pendingClosePrompt,
      }),

      "app:quit": () => {
        pendingClosePrompt = false;
        requestQuit();
        return { quitting: true };
      },

      "app:closeToTray": () => {
        pendingClosePrompt = false;
        closeWindowToTray();
        return { continuing: true };
      },

      "shell:openExternal": async ({ url }) => ({
        opened: Utils.openExternal(url),
      }),

      "auth:setState": async ({ signedIn }) => {
        authState.signedIn = signedIn;

        if (!signedIn) {
          pendingClosePrompt = false;
          await stopActiveWatcher();
        }

        return { signedIn: authState.signedIn };
      },

      "watcher:start": async ({ dir }) => {
        if (process.platform !== "win32") {
          throw new Error("Folder watching is only supported on Windows.");
        }

        if (!authState.signedIn) {
          throw new Error("Sign in to enable folder watching.");
        }

        const target = dir ?? appSettings.get().watchDir ?? defaultWatchDir();
        await stopActiveWatcher();
        watcher = new ReplayWatcher(target, (filePath) => {
          win?.webview.rpc?.send["watcher:file"]({ path: filePath });
        });
        await watcher.start();
        return { watching: true, dir: target };
      },

      "watcher:stop": async () => {
        await stopActiveWatcher();
        return { watching: false };
      },

      "watcher:scan": async ({ dir }) =>
        ReplayWatcher.scanOnce(dir ?? appSettings.get().watchDir ?? defaultWatchDir()),

      "dialog:pickFolder": async () => {
        const paths = await Utils.openFileDialog({
          startingFolder: appSettings.get().watchDir ?? defaultWatchDir(),
          allowedFileTypes: "*",
          canChooseFiles: false,
          canChooseDirectory: true,
          allowsMultipleSelection: false,
        });
        return paths?.[0] ?? null;
      },

      "dialog:pickReplays": async () => {
        const paths = await Utils.openFileDialog({
          startingFolder: appSettings.get().watchDir ?? defaultWatchDir(),
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
        const out = join(downloads, `replay-upload-log-${Date.now()}.json`);
        await uploadLog.exportTo(out);
        return out;
      },
    },
    messages: {},
  },
});

function createMainWindow(initialUrl: string): BrowserWindow<typeof rpc> {
  return new BrowserWindow({
    title: "Stringify Desktop",
    url: initialUrl,
    frame: { width: 1100, height: 760, x: 200, y: 200 },
    rpc,
  });
}

function installAppMenu(): void {
  ApplicationMenu.setApplicationMenu([
    {
      label: "App",
      submenu: [
        { label: "About Stringify Desktop", role: "hide" },
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
        { type: "separator" },
        { role: "close" },
      ],
    },
  ]);
}

async function bootstrap() {
  startOAuthCallbackServer();
  installTray();
  win = createTrackedMainWindow(APP_UI_HOME_URL);
  installAppMenu();
  deliverPendingOAuthCallback();
  deliverPendingClosePrompt();
}

Electrobun.events.on("before-quit", (event) => {
  if (allowExplicitQuit) {
    allowExplicitQuit = false;
    return;
  }

  if (keepRunningInTrayOnNextQuit) {
    keepRunningInTrayOnNextQuit = false;
    event.response = { allow: false };
    notifyTrayMode();
    return;
  }

  if (!shouldOfferTrayOnClose()) {
    return;
  }

  event.response = { allow: false };
  showClosePrompt();
});

await bootstrap();
