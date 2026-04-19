# Stringify Desktop

Cross-platform [Electrobun](https://blackboard.sh/electrobun) + React app that watches the Strinova replay folder on Windows and uploads new `.replay` files through the Strinova API, which returns per-file signed upload URLs.

Authentication uses Clerk as an OAuth/OIDC provider. The desktop app is a public OAuth client that opens the system browser, completes an Authorization Code + PKCE flow, and receives the result back through a localhost loopback callback at `http://localhost:53918/callback`.

## Stack

- [Electrobun](https://blackboard.sh/electrobun) for the native Bun + webview shell
- [Bun](https://bun.sh) as runtime, package manager, and bundler
- React 19 in the webview
- Clerk OAuth/OIDC endpoints for browser sign-in and token exchange
- `chokidar` for lightweight folder watching in the Bun process
- Persistent JSON log written to `Utils.paths.userData/upload-log.json`

## Architecture

| Layer | File | Responsibility |
| --- | --- | --- |
| Bun (main) | [src/bun/index.ts](src/bun/index.ts) | App lifecycle, RPC handlers, native dialogs, file reads, localhost OAuth callback server |
| Bun | [src/bun/watcher.ts](src/bun/watcher.ts) | `chokidar` wrapper, scans for `*.replay` |
| Bun | [src/bun/log.ts](src/bun/log.ts) | Persistent JSON log via `Bun.file` / `Bun.write` |
| Shared | [src/shared/types.ts](src/shared/types.ts) | Typed `RPCSchema` shared between Bun and the webview |
| Shared | [src/shared/appConfig.ts](src/shared/appConfig.ts) | App URLs plus OAuth issuer/client configuration |
| Webview | [src/mainview/index.tsx](src/mainview/index.tsx) | Boots `Electroview`, defines RPC, mounts React |
| Webview | [src/auth/oauth.tsx](src/auth/oauth.tsx) | OAuth PKCE flow, token storage, refresh logic |
| Webview | [src/api/backend.ts](src/api/backend.ts) | Upload API request (`POST /api/upload`) |
| Webview | [src/uploader/uploader.ts](src/uploader/uploader.ts) | Upload pipeline (read -> request signed URL -> PUT) |
| Webview | [src/ui/AuthPanel.tsx](src/ui/AuthPanel.tsx) | Browser sign-in and callback UI |
| Webview | [src/ui/App.tsx](src/ui/App.tsx) | Main app UI |

Bundled renderer assets load from Electrobun's `views://` scheme. The Bun process listens on `http://localhost:53918/callback` for the OAuth redirect, logs the callback URL, and then routes the query back into the bundled `#/sso-callback` view.

## Setup

```bash
bun install
cp .env.example .env
# BACKEND_URL is optional; it defaults to https://strinova.gg
bun run dev
```

## Configuration

Environment variables are read by [electrobun.config.ts](electrobun.config.ts) at build time and inlined into the bundle.

| Env var | Purpose |
| --- | --- |
| `CLERK_OAUTH_ISSUER` | OAuth issuer base URL, defaults to `https://clerk.strinova.gg` |
| `CLERK_OAUTH_CLIENT_ID` | Public OAuth client ID, defaults to `9YfNu3Z7Vm9PvZ6G` |
| `BACKEND_URL` | Base URL of the Strinova API, defaults to `https://strinova.gg` |

The desktop app uses these OAuth endpoints:

- `GET {CLERK_OAUTH_ISSUER}/oauth/authorize`
- `POST {CLERK_OAUTH_ISSUER}/oauth/token`
- `GET {CLERK_OAUTH_ISSUER}/oauth/userinfo`

Clerk should allowlist this redirect URI for the desktop OAuth application:

- `http://localhost:53918/callback`

## Backend Expectations

The upload backend is expected to expose:

```http
POST {BACKEND_URL}/api/upload
Authorization: Bearer <OAuth access token>
Content-Type: application/json

{
  "files": [
    { "name": "Match_1.replay", "size": 12345678 }
  ]
}
```

And return a payload shaped like:

```json
{
  "urls": [
    { "name": "Match_1.replay", "signedUrl": "https://storage.googleapis.com/..." }
  ]
}
```

If the backend is protected by Clerk, its Next.js routes should accept `oauth_token`s, for example:

```ts
import { auth } from "@clerk/nextjs/server";

const authState = await auth({ acceptsToken: "oauth_token" });
```

## Behavior

- The app opens the system browser for sign-in and completes the OAuth code exchange locally with PKCE.
- The Bun main process runs a localhost callback server on port `53918`.
- Access tokens are stored locally with their refresh token and renewed automatically when needed.
- The watcher is enabled only on Windows; other platforms still support manual sync and file picking.
- Both the `/api/upload` call and the signed upload treat HTTP `403` as "already uploaded" and stop retrying automatically.
- Upload history persists in `Utils.paths.userData/upload-log.json`.

## Verification

```bash
bun run typecheck
bun run build
```
