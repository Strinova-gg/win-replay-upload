import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  APP_OAUTH_AUTHORIZE_URL,
  APP_OAUTH_CALLBACK_URL,
  APP_OAUTH_CLIENT_ID,
  APP_OAUTH_SCOPES,
  APP_OAUTH_TOKEN_URL,
  APP_OAUTH_USERINFO_URL,
} from "../shared/appConfig";

const SESSION_STORAGE_KEY = "desktop.oauth.session";
const FLOW_STORAGE_KEY = "desktop.oauth.flow";
const CODE_MAX_AGE_MS = 10 * 60_000;
const TOKEN_REFRESH_SKEW_MS = 60_000;

export interface DesktopAuthUser {
  sub: string;
  email?: string;
  emailVerified?: boolean;
  name?: string;
  preferredUsername?: string;
  picture?: string;
}

interface StoredSession {
  accessToken: string;
  refreshToken: string | null;
  idToken: string | null;
  tokenType: string;
  scope: string;
  expiresAt: number;
  user: DesktopAuthUser;
}

interface PendingAuthFlow {
  state: string;
  nonce: string;
  codeVerifier: string;
  createdAt: number;
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  id_token?: string;
  token_type: string;
  scope?: string;
  expires_in: number;
}

interface UserInfoResponse {
  sub: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  preferred_username?: string;
  picture?: string;
}

interface DesktopAuthContextValue {
  isLoaded: boolean;
  isSignedIn: boolean;
  user: DesktopAuthUser | null;
  buildSignInUrl: () => Promise<string>;
  completeSignInFromCallback: (search: string) => Promise<void>;
  getAccessToken: () => Promise<string | null>;
  signOut: () => Promise<void>;
}

const DesktopAuthContext = createContext<DesktopAuthContextValue | null>(null);

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function randomBase64Url(byteLength = 32): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

async function createCodeChallenge(codeVerifier: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(codeVerifier),
  );
  return bytesToBase64Url(new Uint8Array(digest));
}

function writeJson(key: string, value: unknown): void {
  window.localStorage.setItem(key, JSON.stringify(value));
}

function readJson<T>(key: string): T | null {
  const raw = window.localStorage.getItem(key);
  if (!raw) return null;

  try {
    return JSON.parse(raw) as T;
  } catch {
    window.localStorage.removeItem(key);
    return null;
  }
}

function clearJson(key: string): void {
  window.localStorage.removeItem(key);
}

function readStoredSession(): StoredSession | null {
  const session = readJson<StoredSession>(SESSION_STORAGE_KEY);
  if (!session?.accessToken || typeof session.expiresAt !== "number") {
    clearJson(SESSION_STORAGE_KEY);
    return null;
  }
  return session;
}

function writeStoredSession(session: StoredSession): void {
  writeJson(SESSION_STORAGE_KEY, session);
}

function clearStoredSession(): void {
  clearJson(SESSION_STORAGE_KEY);
}

function readPendingFlow(): PendingAuthFlow | null {
  const flow = readJson<PendingAuthFlow>(FLOW_STORAGE_KEY);
  if (!flow?.state || !flow.codeVerifier || typeof flow.createdAt !== "number") {
    clearJson(FLOW_STORAGE_KEY);
    return null;
  }
  return flow;
}

function writePendingFlow(flow: PendingAuthFlow): void {
  writeJson(FLOW_STORAGE_KEY, flow);
}

function clearPendingFlow(): void {
  clearJson(FLOW_STORAGE_KEY);
}

function getTokenExpiry(expiresInSeconds: number): number {
  return Date.now() + Math.max(expiresInSeconds, 1) * 1000;
}

function parseJwtPayload(token: string | null | undefined): Record<string, unknown> | null {
  if (!token) return null;

  const [, payload] = token.split(".");
  if (!payload) return null;

  try {
    const padded = payload.padEnd(payload.length + ((4 - (payload.length % 4)) % 4), "=");
    const normalized = padded.replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(normalized)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function normalizeUserInfo(
  user: UserInfoResponse | Record<string, unknown> | null,
): DesktopAuthUser | null {
  if (!user || typeof user.sub !== "string" || user.sub.length === 0) {
    return null;
  }

  const record = user as Record<string, unknown>;

  return {
    sub: user.sub,
    email: typeof user.email === "string" ? user.email : undefined,
    emailVerified:
      typeof user.email_verified === "boolean"
        ? user.email_verified
        : typeof record.emailVerified === "boolean"
          ? record.emailVerified
          : undefined,
    name: typeof user.name === "string" ? user.name : undefined,
    preferredUsername:
      typeof user.preferred_username === "string"
        ? user.preferred_username
        : typeof record.preferredUsername === "string"
          ? record.preferredUsername
          : undefined,
    picture: typeof user.picture === "string" ? user.picture : undefined,
  };
}

async function readOAuthError(response: Response): Promise<string> {
  try {
    const data = (await response.json()) as {
      error?: string;
      error_description?: string;
      message?: string;
    };
    if (data.error_description) return data.error_description;
    if (data.message) return data.message;
    if (data.error) return data.error;
  } catch {
    // Ignore parsing errors and fall through.
  }

  return `${response.status} ${response.statusText}`.trim();
}

async function requestToken(
  body: URLSearchParams,
): Promise<TokenResponse> {
  const response = await fetch(APP_OAUTH_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
    },
    body,
  });

  if (!response.ok) {
    throw new Error(`Token exchange failed: ${await readOAuthError(response)}`);
  }

  return (await response.json()) as TokenResponse;
}

async function fetchUserInfo(accessToken: string): Promise<DesktopAuthUser> {
  const response = await fetch(APP_OAUTH_USERINFO_URL, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    throw new Error(`User info request failed: ${await readOAuthError(response)}`);
  }

  const data = (await response.json()) as UserInfoResponse;
  const user = normalizeUserInfo(data);
  if (!user) {
    throw new Error("User info response did not include a subject.");
  }

  return user;
}

function sessionNeedsRefresh(session: StoredSession): boolean {
  return session.expiresAt <= Date.now() + TOKEN_REFRESH_SKEW_MS;
}

function buildStoredSession(
  token: TokenResponse,
  user: DesktopAuthUser,
  previous?: StoredSession | null,
): StoredSession {
  return {
    accessToken: token.access_token,
    refreshToken: token.refresh_token ?? previous?.refreshToken ?? null,
    idToken: token.id_token ?? previous?.idToken ?? null,
    tokenType: token.token_type,
    scope: token.scope ?? previous?.scope ?? APP_OAUTH_SCOPES,
    expiresAt: getTokenExpiry(token.expires_in),
    user,
  };
}

async function exchangeAuthorizationCode(
  code: string,
  codeVerifier: string,
): Promise<TokenResponse> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: APP_OAUTH_CLIENT_ID,
    redirect_uri: APP_OAUTH_CALLBACK_URL,
    code,
    code_verifier: codeVerifier,
  });

  return requestToken(body);
}

async function refreshSession(previous: StoredSession): Promise<StoredSession> {
  if (!previous.refreshToken) {
    throw new Error("This session cannot be refreshed.");
  }

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: APP_OAUTH_CLIENT_ID,
    refresh_token: previous.refreshToken,
  });

  const token = await requestToken(body);
  return buildStoredSession(token, previous.user, previous);
}

export function DesktopAuthProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [isLoaded, setIsLoaded] = useState(false);
  const [session, setSession] = useState<StoredSession | null>(null);
  const sessionRef = useRef<StoredSession | null>(null);
  const refreshPromiseRef = useRef<Promise<StoredSession | null> | null>(null);

  const commitSession = useCallback((next: StoredSession | null) => {
    sessionRef.current = next;
    setSession(next);

    if (next) {
      writeStoredSession(next);
    } else {
      clearStoredSession();
    }
  }, []);

  const ensureFreshSession = useCallback(
    async (force = false): Promise<StoredSession | null> => {
      const current = sessionRef.current ?? readStoredSession();
      if (!current) {
        commitSession(null);
        return null;
      }

      if (!force && !sessionNeedsRefresh(current)) {
        if (sessionRef.current !== current) {
          commitSession(current);
        }
        return current;
      }

      if (!current.refreshToken) {
        commitSession(null);
        return null;
      }

      if (!refreshPromiseRef.current) {
        refreshPromiseRef.current = (async () => {
          try {
            const refreshed = await refreshSession(current);
            commitSession(refreshed);
            return refreshed;
          } catch {
            commitSession(null);
            return null;
          } finally {
            refreshPromiseRef.current = null;
          }
        })();
      }

      return refreshPromiseRef.current;
    },
    [commitSession],
  );

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const restored = readStoredSession();
      if (!restored) {
        if (!cancelled) {
          commitSession(null);
          setIsLoaded(true);
        }
        return;
      }

      const fresh = await ensureFreshSession();
      if (!cancelled) {
        commitSession(fresh);
        setIsLoaded(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [commitSession, ensureFreshSession]);

  const buildSignInUrl = useCallback(async () => {
    const flow: PendingAuthFlow = {
      state: randomBase64Url(24),
      nonce: randomBase64Url(24),
      codeVerifier: randomBase64Url(32),
      createdAt: Date.now(),
    };
    writePendingFlow(flow);

    const params = new URLSearchParams({
      response_type: "code",
      client_id: APP_OAUTH_CLIENT_ID,
      redirect_uri: APP_OAUTH_CALLBACK_URL,
      scope: APP_OAUTH_SCOPES,
      state: flow.state,
      nonce: flow.nonce,
      code_challenge: await createCodeChallenge(flow.codeVerifier),
      code_challenge_method: "S256",
    });

    return `${APP_OAUTH_AUTHORIZE_URL}?${params.toString()}`;
  }, []);

  const completeSignInFromCallback = useCallback(
    async (search: string) => {
      const params = new URLSearchParams(search);
      const error = params.get("error");
      if (error) {
        const description = params.get("error_description");
        throw new Error(description ?? error);
      }

      const code = params.get("code");
      const state = params.get("state");
      if (!code || !state) {
        throw new Error("The callback did not include an authorization code.");
      }

      const flow = readPendingFlow();
      if (!flow) {
        throw new Error("No pending sign-in request was found on this device.");
      }

      if (Date.now() - flow.createdAt > CODE_MAX_AGE_MS) {
        clearPendingFlow();
        throw new Error("The sign-in callback expired. Please try again.");
      }

      if (flow.state !== state) {
        clearPendingFlow();
        throw new Error("The sign-in callback state did not match this device.");
      }

      const token = await exchangeAuthorizationCode(code, flow.codeVerifier);

      let user: DesktopAuthUser | null = null;
      try {
        user = await fetchUserInfo(token.access_token);
      } catch {
        user = normalizeUserInfo(parseJwtPayload(token.id_token));
      }

      if (!user) {
        clearPendingFlow();
        throw new Error("Authentication succeeded, but user information was unavailable.");
      }

      clearPendingFlow();
      commitSession(buildStoredSession(token, user));
    },
    [commitSession],
  );

  const getAccessToken = useCallback(async () => {
    const fresh = await ensureFreshSession();
    return fresh?.accessToken ?? null;
  }, [ensureFreshSession]);

  const signOut = useCallback(async () => {
    clearPendingFlow();
    commitSession(null);
  }, [commitSession]);

  const value = useMemo<DesktopAuthContextValue>(
    () => ({
      isLoaded,
      isSignedIn: !!session,
      user: session?.user ?? null,
      buildSignInUrl,
      completeSignInFromCallback,
      getAccessToken,
      signOut,
    }),
    [
      buildSignInUrl,
      completeSignInFromCallback,
      getAccessToken,
      isLoaded,
      session,
      signOut,
    ],
  );

  return (
    <DesktopAuthContext.Provider value={value}>
      {children}
    </DesktopAuthContext.Provider>
  );
}

export function useDesktopAuth(): DesktopAuthContextValue {
  const context = useContext(DesktopAuthContext);
  if (!context) {
    throw new Error("useDesktopAuth must be used inside DesktopAuthProvider");
  }
  return context;
}
