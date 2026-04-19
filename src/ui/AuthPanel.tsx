import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDesktopAuth } from "../auth/oauth";
import { bridge } from "../bridge/bridge";
import {
  APP_OAUTH_CALLBACK_HASH,
  APP_OAUTH_CALLBACK_URL,
  APP_UI_HOME_URL,
} from "../shared/appConfig";

type CallbackPayload = {
  search: string;
  rawUrl: string;
};

function isSsoCallbackHash(hash: string): boolean {
  return hash.startsWith(APP_OAUTH_CALLBACK_HASH);
}

function getCallbackSearchFromHash(hash: string): string {
  if (!isSsoCallbackHash(hash)) {
    return "";
  }

  const queryIndex = hash.indexOf("?");
  return queryIndex >= 0 ? hash.slice(queryIndex) : "";
}

function tryResetUrl(): void {
  try {
    window.history.replaceState(null, "", APP_UI_HOME_URL);
  } catch {
    if (window.location.href !== APP_UI_HOME_URL) {
      window.location.assign(APP_UI_HOME_URL);
    }
  }
}

function getCallbackErrorMessage(cause: unknown): string {
  if (cause instanceof Error) {
    return cause.message;
  }

  return "Unable to continue sign-in.";
}

function SsoCallbackPanel({
  payload,
  onReset,
}: {
  payload: CallbackPayload;
  onReset: () => void;
}) {
  const { completeSignInFromCallback } = useDesktopAuth();
  const hasRun = useRef(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      if (hasRun.current) {
        return;
      }

      hasRun.current = true;

      try {
        await completeSignInFromCallback(payload.search);
        tryResetUrl();
      } catch (cause) {
        setError(getCallbackErrorMessage(cause));
      }
    })();
  }, [completeSignInFromCallback, payload.search]);

  return (
    <section className="panel auth-panel">
      <h2>Completing browser sign-in</h2>
      <p className="muted auth-copy">
        Finalizing the secure browser handoff and restoring the desktop session.
      </p>

      {error ? (
        <div className="notice err">
          <div>{error}</div>
          <div className="auth-actions">
            <button
              type="button"
              onClick={() => {
                onReset();
                tryResetUrl();
              }}
            >
              Back to sign-in
            </button>
          </div>
        </div>
      ) : (
        <div className="notice">
          Waiting for the authorization response from <code>{payload.rawUrl}</code>.
        </div>
      )}
    </section>
  );
}

export function AuthPanel() {
  const { buildSignInUrl } = useDesktopAuth();
  const [error, setError] = useState<string | null>(null);
  const [openingBrowser, setOpeningBrowser] = useState(false);
  const [callbackPayload, setCallbackPayload] = useState<CallbackPayload | null>(null);

  useEffect(() => {
    const hashSearch = getCallbackSearchFromHash(window.location.hash);
    if (hashSearch) {
      setCallbackPayload({
        search: hashSearch,
        rawUrl: `${APP_OAUTH_CALLBACK_URL}${hashSearch}`,
      });
    }

    return bridge().auth.onCallback((payload) => {
      setCallbackPayload(payload);
    });
  }, []);

  const startBrowserAuth = useCallback(async () => {
    setOpeningBrowser(true);
    setError(null);

    try {
      const signInUrl = await buildSignInUrl();

      if (!/^https:\/\//i.test(signInUrl)) {
        setError("The OAuth client did not produce a secure browser sign-in URL.");
        return;
      }

      const { opened } = await bridge().shell.openExternal(signInUrl);
      if (!opened) {
        setError("The app could not open your default browser for sign-in.");
      }
    } catch (cause) {
      setError(getCallbackErrorMessage(cause));
    } finally {
      setOpeningBrowser(false);
    }
  }, [buildSignInUrl]);

  const activeCallbackPayload = useMemo(() => {
    if (callbackPayload) {
      return callbackPayload;
    }

    const hashSearch = getCallbackSearchFromHash(window.location.hash);
    if (!hashSearch) {
      return null;
    }

    return {
      search: hashSearch,
      rawUrl: `${APP_OAUTH_CALLBACK_URL}${hashSearch}`,
    };
  }, [callbackPayload]);

  if (activeCallbackPayload) {
    return (
      <SsoCallbackPanel
        payload={activeCallbackPayload}
        onReset={() => {
          setCallbackPayload(null);
        }}
      />
    );
  }

  return (
    <section className="auth-landing" aria-label="Authentication">
      <div className="auth-actions">
        <button
          type="button"
          className="auth-primary-button"
          onClick={startBrowserAuth}
          disabled={openingBrowser}
        >
          {openingBrowser ? "Opening browser..." : "Sign in with Stringify"}
        </button>
      </div>

      {error && <div className="notice err auth-error">{error}</div>}
    </section>
  );
}
