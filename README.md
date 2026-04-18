# Strinova Replay Uploader

Cross-platform [Electrobun](https://blackboard.sh/electrobun) + React + Clerk app that watches the Strinova replay folder on Windows and uploads new `.replay` files to a backend-issued, pre-signed Google Cloud Storage URL.

## Stack

- [Electrobun](https://blackboard.sh/electrobun) (Bun runtime + native webview shell)
- [Bun](https://bun.sh) as runtime + package manager + bundler
- React 19 + `@clerk/clerk-react` in the webview
- `chokidar` for lightweight folder watching in the Bun process
- Persistent JSON log written to `Utils.paths.userData/upload-log.json`

## Architecture

| Layer | File | Responsibility |
| --- | --- | --- |
| Bun (main) | [src/bun/index.ts](src/bun/index.ts) | App lifecycle, RPC handlers, native dialogs, file reads, default watch dir |
| Bun | [src/bun/watcher.ts](src/bun/watcher.ts) | `chokidar` wrapper, scans for `*.replay` |
| Bun | [src/bun/log.ts](src/bun/log.ts) | Persistent JSON log via `Bun.file` / `Bun.write` |
| Shared | [src/shared/types.ts](src/shared/types.ts) | Typed `RPCSchema` shared between Bun and the webview |
| Webview | [src/mainview/index.tsx](src/mainview/index.tsx) | Boots `Electroview`, defines RPC, mounts React |
| Webview | [src/bridge/bridge.ts](src/bridge/bridge.ts) | Typed accessor over the Electroview RPC client |
| Webview | [src/auth/clerk.tsx](src/auth/clerk.tsx) | `useClerkToken` hook |
| Webview | [src/api/backend.ts](src/api/backend.ts) | Pre-sign request (`POST /replays/presign`) |
| Webview | [src/uploader/uploader.ts](src/uploader/uploader.ts) | Upload pipeline (presign → read → PUT) |
| Webview | [src/log/uploadLog.ts](src/log/uploadLog.ts) | Webview-side log helpers |
| Webview | [src/watcher/fileWatcher.ts](src/watcher/fileWatcher.ts) | React hook for watcher events |
| Webview | [src/ui/App.tsx](src/ui/App.tsx) | UI |

The webview process never touches Bun/Node APIs directly. Every call goes through a typed RPC bridge (`Electroview.defineRPC` + `BrowserView.defineRPC`) declared once in [src/shared/types.ts](src/shared/types.ts).

## Setup

```bash
bun install
cp .env.example .env
# fill in CLERK_PUBLISHABLE_KEY and BACKEND_URL
bun run dev          # electrobun dev (build + launch)
bun run dev:watch    # electrobun dev --watch (rebuild + relaunch on file change)
```

> The first build downloads the Electrobun core binaries (~26 MB) into `node_modules/electrobun/.cache/`.

## Configuration

Environment variables are read by [electrobun.config.ts](electrobun.config.ts) at build time and inlined into the bundle via `define`.

| Env var | Purpose |
| --- | --- |
| `CLERK_PUBLISHABLE_KEY` | Clerk publishable key, inlined into the webview bundle |
| `BACKEND_URL` | Base URL of the API that issues pre-signed GCS URLs |

The backend is expected to expose:

```
POST {BACKEND_URL}/replays/presign
Authorization: Bearer <Clerk session JWT>
Content-Type: application/json
{ "fileName": "Match_1.replay" }

200 OK
{ "uploadUrl": "https://storage.googleapis.com/…", "headers": { … }, "method": "PUT" }

403 — file is already uploaded; client logs and skips on future runs.
```

## Behavior

- **Platform detection.** On startup the Bun process reports `process.platform`. On Windows the watcher button is enabled; everything else shows a notice and limits the user to manual sync / file-picker uploads.
- **Default watch dir.** `%LOCALAPPDATA%\Strinova\Saved\Demos` on Windows.
- **Watcher.** `chokidar` with `depth: 0`, `ignoreInitial: true`, and `awaitWriteFinish` to keep it lightweight and avoid uploading files that are still being written. Users can stop the watcher and manually sync at any time.
- **Upload log.** JSON file at `Utils.paths.userData/upload-log.json`. Entries: `uploaded`, `already-uploaded` (403), `failed`. `uploaded` and `already-uploaded` files are skipped automatically; `failed` files can be retried via the UI.
- **403 handling.** Both the presign call and the GCS PUT treat HTTP 403 as "already uploaded" — logged and never retried automatically.
- **Token refresh.** The webview calls `getToken()` from `@clerk/clerk-react` on every request, so long-lived sessions stay valid via Clerk's built-in refresh.
- **File transport.** Files are read in the Bun process and base64-encoded over RPC, then decoded back to bytes in the webview before the `fetch` PUT.

## Verification checklist

1. **Auth.** Sign in via Clerk; the `Authorization: Bearer …` header is attached to `POST /replays/presign`.
2. **Windows happy-path.** Drop a `.replay` file in the watched folder → see "Uploading …" then "Uploaded" in Activity, and a row in the log table.
3. **Non-Windows.** Launch on macOS/Linux → notice banner appears, "Start watching" is disabled, manual sync and file picker still work.
4. **403 behavior.** Backend returns 403 → entry shows `already-uploaded`, future runs skip it.
5. **Persistence.** Restart the app → log persists; previously uploaded / 403 files are skipped on the next manual sync.

## Build & package

```bash
bun run build      # electrobun build (dev bundle in build/dev-<platform>-<arch>/)
bun run package    # electrobun build --env=stable (signed/notarized bundle, if configured)
bun run typecheck  # tsc --noEmit
```

For multi-platform distribution, run `bun run package` on a CI runner per OS/arch — see Electrobun's [Cross-Platform Development](https://blackboard.sh/electrobun/docs/guides/cross-platform-development) guide.
