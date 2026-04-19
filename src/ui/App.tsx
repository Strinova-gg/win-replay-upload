import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDesktopAuth } from "../auth/oauth";
import { bridge } from "../bridge/bridge";
import { log, type LogEntry, shouldSkip } from "../log/uploadLog";
import { uploadReplay } from "../uploader/uploader";
import { watcher, useFileWatcher } from "../watcher/fileWatcher";
import { AuthPanel } from "./AuthPanel";

interface PlatformInfo {
  platform: NodeJS.Platform;
  isWindows: boolean;
  defaultWatchDir: string;
}

type Activity = {
  id: string;
  ts: number;
  level: "info" | "warn" | "error";
  message: string;
};

function basename(path: string): string {
  const separatorIndex = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return separatorIndex >= 0 ? path.slice(separatorIndex + 1) : path;
}

export function App() {
  const { isLoaded: authLoaded, isSignedIn, signOut, user, getAccessToken } =
    useDesktopAuth();
  const showStandaloneAuth = authLoaded && !isSignedIn;

  const [platform, setPlatform] = useState<PlatformInfo | null>(null);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [mainAuthSynced, setMainAuthSynced] = useState(false);
  const [autoSyncEnabled, setAutoSyncEnabled] = useState(true);
  const [showClosePrompt, setShowClosePrompt] = useState(false);
  const [watchDir, setWatchDir] = useState("");
  const [watchDirInput, setWatchDirInput] = useState("");
  const [watching, setWatching] = useState(false);
  const [entries, setEntries] = useState<Record<string, LogEntry>>({});
  const [activity, setActivity] = useState<Activity[]>([]);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef<Set<string>>(new Set());
  const activeWatchDir = useRef<string | null>(null);

  const pushActivity = useCallback((level: Activity["level"], message: string) => {
    setActivity((previous) =>
      [{ id: crypto.randomUUID(), ts: Date.now(), level, message }, ...previous].slice(0, 200),
    );
  }, []);

  const refreshLog = useCallback(async () => {
    setEntries(await log.all());
  }, []);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const [info, settings] = await Promise.all([
        bridge().platform(),
        bridge().settings.get(),
      ]);

      if (cancelled) {
        return;
      }

      const initialWatchDir = settings.watchDir ?? info.defaultWatchDir;
      setPlatform(info);
      setAutoSyncEnabled(settings.autoSyncEnabled);
      setWatchDir(initialWatchDir);
      setWatchDirInput(initialWatchDir);
      setSettingsLoaded(true);
      await refreshLog();
    })();

    return () => {
      cancelled = true;
    };
  }, [refreshLog]);

  useEffect(() => {
    let cancelled = false;

    const off = bridge().app.onShowClosePrompt(() => {
      setShowClosePrompt(true);
    });

    void (async () => {
      const { pending } = await bridge().app.getClosePromptState();
      if (!cancelled && pending) {
        setShowClosePrompt(true);
      }
    })();

    return () => {
      cancelled = true;
      off();
    };
  }, []);

  useEffect(() => {
    if (!authLoaded) {
      setMainAuthSynced(false);
      return;
    }

    let cancelled = false;
    setMainAuthSynced(false);

    void bridge()
      .auth.setSignedIn(isSignedIn)
      .then(() => {
        if (!cancelled) {
          setMainAuthSynced(true);
        }
      })
      .catch((error) => {
        console.error("Could not sync auth state to main process:", error);
      });

    return () => {
      cancelled = true;
    };
  }, [authLoaded, isSignedIn]);

  useEffect(() => {
    if (!isSignedIn && showClosePrompt) {
      setShowClosePrompt(false);
    }
  }, [isSignedIn, showClosePrompt]);

  const processFile = useCallback(
    async (filePath: string) => {
      const fileName = basename(filePath);
      if (inFlight.current.has(fileName)) return;

      if (!isSignedIn) {
        pushActivity("warn", `Skipping ${fileName}: sign in to sync replays.`);
        return;
      }

      const existing = await log.statusOf(fileName);
      if (shouldSkip(existing)) {
        pushActivity("info", `Skipping ${fileName} (${existing!.status}).`);
        return;
      }

      inFlight.current.add(fileName);
      pushActivity("info", `Uploading ${fileName}...`);

      const outcome = await uploadReplay({
        filePath,
        fileName,
        getToken: getAccessToken,
      });
      const at = new Date().toISOString();

      let entry: LogEntry;
      if (outcome.kind === "uploaded") {
        entry = { status: "uploaded", at };
        pushActivity("info", `Uploaded ${fileName}.`);
      } else if (outcome.kind === "already-uploaded") {
        entry = { status: "already-uploaded", at, httpStatus: outcome.httpStatus };
        pushActivity("warn", `${fileName} already uploaded (403). Will not retry.`);
      } else {
        entry = {
          status: "failed",
          at,
          error: outcome.error,
          httpStatus: outcome.httpStatus,
        };
        pushActivity("error", `Failed ${fileName}: ${outcome.error}`);
      }

      await log.record(fileName, entry);
      await refreshLog();
      inFlight.current.delete(fileName);
    },
    [getAccessToken, isSignedIn, pushActivity, refreshLog],
  );

  useFileWatcher({ onFile: processFile });

  const resolvedManualDir =
    watchDirInput.trim() || watchDir || platform?.defaultWatchDir || "";

  const commitWatchDir = useCallback(
    async (nextDir: string) => {
      const normalized = nextDir.trim();
      if (!normalized) {
        setWatchDirInput(watchDir);
        return;
      }

      setWatchDirInput(normalized);

      if (normalized === watchDir) {
        return;
      }

      setWatchDir(normalized);

      try {
        await bridge().settings.update({ watchDir: normalized });
      } catch (error) {
        pushActivity("error", `Could not save watch folder: ${(error as Error).message}`);
      }
    },
    [pushActivity, watchDir],
  );

  const startWatching = useCallback(
    async (targetDir = watchDir || platform?.defaultWatchDir || "") => {
      if (!platform?.isWindows || !targetDir) return false;

      try {
        const result = await watcher.start(targetDir);
        setWatching(result.watching);

        if (activeWatchDir.current !== result.dir) {
          pushActivity("info", `Watching ${result.dir}.`);
        }

        activeWatchDir.current = result.dir;
        return true;
      } catch (error) {
        setWatching(false);
        activeWatchDir.current = null;
        pushActivity("error", (error as Error).message);
        return false;
      }
    },
    [platform, pushActivity, watchDir],
  );

  const stopWatching = useCallback(async () => {
    try {
      await watcher.stop();
    } catch (error) {
      pushActivity("error", (error as Error).message);
      return false;
    }

    const wasWatching = activeWatchDir.current !== null || watching;
    setWatching(false);
    activeWatchDir.current = null;

    if (wasWatching) {
      pushActivity("info", "Stopped watcher.");
    }

    return true;
  }, [pushActivity, watching]);

  useEffect(() => {
    if (!settingsLoaded || !platform || !authLoaded || !mainAuthSynced) {
      return;
    }

    const shouldWatch = platform.isWindows && isSignedIn && autoSyncEnabled;
    const targetDir = watchDir || platform.defaultWatchDir;

    if (shouldWatch) {
      if (watching && activeWatchDir.current === targetDir) {
        return;
      }

      void startWatching(targetDir);
      return;
    }

    if (!watching && activeWatchDir.current === null) {
      return;
    }

    void stopWatching();
  }, [
    authLoaded,
    autoSyncEnabled,
    isSignedIn,
    mainAuthSynced,
    platform,
    settingsLoaded,
    startWatching,
    stopWatching,
    watchDir,
    watching,
  ]);

  const handleToggleAutoSync = useCallback(async () => {
    const next = !autoSyncEnabled;
    setAutoSyncEnabled(next);

    try {
      await bridge().settings.update({ autoSyncEnabled: next });
      pushActivity("info", next ? "Auto-sync enabled." : "Auto-sync disabled.");
    } catch (error) {
      setAutoSyncEnabled(!next);
      pushActivity("error", `Could not update auto-sync: ${(error as Error).message}`);
    }
  }, [autoSyncEnabled, pushActivity]);

  const handleContinueSyncing = useCallback(async () => {
    setShowClosePrompt(false);
    await bridge().app.closeToTray();
  }, []);

  const handleQuitApp = useCallback(async () => {
    setShowClosePrompt(false);
    await bridge().app.quit();
  }, []);

  const handleManualSync = useCallback(async () => {
    if (!isSignedIn) {
      pushActivity("warn", "Manual sync is unavailable until you sign in.");
      return;
    }

    setBusy(true);
    try {
      pushActivity("info", `Scanning ${resolvedManualDir}...`);
      const files = await watcher.scan(resolvedManualDir);
      pushActivity("info", `Found ${files.length} replay file(s).`);
      for (const file of files) {
        await processFile(file);
      }
    } finally {
      setBusy(false);
    }
  }, [isSignedIn, processFile, pushActivity, resolvedManualDir]);

  const handlePickFolder = useCallback(async () => {
    const directory = await bridge().dialog.pickFolder();
    if (directory) {
      await commitWatchDir(directory);
    }
  }, [commitWatchDir]);

  const handlePickFiles = useCallback(async () => {
    if (!isSignedIn) {
      pushActivity("warn", "Pick-file sync is unavailable until you sign in.");
      return;
    }

    const files = await bridge().dialog.pickReplays();
    setBusy(true);
    try {
      for (const file of files) {
        await processFile(file);
      }
    } finally {
      setBusy(false);
    }
  }, [isSignedIn, processFile, pushActivity]);

  const handleClearFailed = useCallback(async () => {
    const removed = await log.clearFailed();
    pushActivity("info", `Cleared ${removed} failed entr${removed === 1 ? "y" : "ies"}.`);
    await refreshLog();
  }, [pushActivity, refreshLog]);

  const handleRetryFailed = useCallback(async () => {
    if (!isSignedIn) {
      pushActivity("warn", "Retry is unavailable until you sign in.");
      return;
    }

    setBusy(true);
    try {
      const failed = Object.entries(entries).filter(([, entry]) => entry.status === "failed");
      pushActivity("info", `Retrying ${failed.length} failed file(s).`);

      const knownFiles = new Map<string, string>();
      const scanned = await watcher.scan(resolvedManualDir);
      for (const path of scanned) {
        knownFiles.set(basename(path), path);
      }

      for (const [name] of failed) {
        const path = knownFiles.get(name);
        if (!path) {
          pushActivity("warn", `Cannot retry ${name}: not found in ${resolvedManualDir}.`);
          continue;
        }

        await log.record(name, {
          status: "failed",
          at: new Date().toISOString(),
          error: "retrying",
        });
        await processFile(path);
      }
    } finally {
      setBusy(false);
    }
  }, [entries, isSignedIn, processFile, pushActivity, resolvedManualDir]);

  const handleSignOut = useCallback(async () => {
    await stopWatching();
    await signOut();
    await bridge().auth.setSignedIn(false);
    pushActivity("info", "Signed out. Sync is paused until you sign back in.");
  }, [pushActivity, signOut, stopWatching]);

  const stats = useMemo(() => {
    let uploaded = 0;
    let already = 0;
    let failed = 0;

    for (const entry of Object.values(entries)) {
      if (entry.status === "uploaded") uploaded++;
      else if (entry.status === "already-uploaded") already++;
      else if (entry.status === "failed") failed++;
    }

    return { uploaded, already, failed, total: uploaded + already + failed };
  }, [entries]);

  const userLabel = user?.email ?? user?.preferredUsername ?? user?.name ?? user?.sub;

  return (
    <div className={showStandaloneAuth ? "app app-auth-screen" : "app"}>
      {showClosePrompt && (
        <div className="modal-backdrop" role="presentation">
          <section
            aria-labelledby="close-prompt-title"
            aria-modal="true"
            className="modal-card"
            role="dialog"
          >
            <h2 id="close-prompt-title">Keep syncing in the tray?</h2>
            <p className="modal-copy">
              Auto-sync is still enabled. Continue syncing to keep the uploader running in the
              background and keep watching for new replays.
            </p>
            <div className="modal-actions">
              <button className="button-danger" onClick={() => void handleQuitApp()}>
                Quit
              </button>
              <button className="button-primary" onClick={() => void handleContinueSyncing()}>
                Continue syncing
              </button>
            </div>
          </section>
        </div>
      )}

      {!showStandaloneAuth && (
        <header className="topbar">
          <h1>Stringify Desktop</h1>
          <div className="auth">
            {!authLoaded && <span className="muted">Loading auth...</span>}
            {authLoaded && isSignedIn && (
              <>
                <span className="muted">{userLabel}</span>
                <button onClick={handleSignOut}>Sign out</button>
              </>
            )}
          </div>
        </header>
      )}

      {!authLoaded && (
        <section className="panel">
          <h2>Authentication</h2>
          <p className="muted">Restoring secure browser sign-in...</p>
        </section>
      )}

      {showStandaloneAuth && <AuthPanel />}

      {authLoaded && isSignedIn && (
        <>
          {platform && !platform.isWindows && (
            <div className="notice warn">
              Folder watching is disabled on <strong>{platform.platform}</strong> and only works
              on Windows. You can still manually pick replay files or a folder to sync.
            </div>
          )}

          <section className="panel">
            <h2>Folder</h2>
            <div className="row">
              <input
                type="text"
                value={watchDirInput}
                onChange={(event) => setWatchDirInput(event.target.value)}
                onBlur={() => {
                  void commitWatchDir(watchDirInput);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    void commitWatchDir(watchDirInput);
                    event.currentTarget.blur();
                  }
                }}
                spellCheck={false}
              />
              <button onClick={handlePickFolder}>Choose folder...</button>
            </div>
            <div className="row">
              {platform?.isWindows ? (
                <button onClick={handleToggleAutoSync}>
                  {autoSyncEnabled ? "Turn auto-sync off" : "Turn auto-sync on"}
                </button>
              ) : (
                <button disabled title="Watching is Windows-only">
                  Auto-sync (Windows only)
                </button>
              )}
              <button onClick={handleManualSync} disabled={busy || !resolvedManualDir}>
                {busy ? "Working..." : "Manual sync now"}
              </button>
              <button onClick={handlePickFiles} disabled={busy}>
                Pick .replay file(s)...
              </button>
            </div>
            <div className="status">
              Auto-sync: <strong>{platform?.isWindows && autoSyncEnabled ? "on" : "off"}</strong>
              {platform?.isWindows && (
                <>
                  {" "}
                  | Watcher: <strong>{watching ? "active" : "idle"}</strong>
                </>
              )}
            </div>
            {platform?.isWindows && autoSyncEnabled && (
              <div className="status">
                Closing the window will offer to continue syncing from the tray.
              </div>
            )}
          </section>

          <section className="panel">
            <h2>Stats</h2>
            <div className="stats">
              <span>Total: {stats.total}</span>
              <span className="ok">Uploaded: {stats.uploaded}</span>
              <span className="warn">Already uploaded: {stats.already}</span>
              <span className="err">Failed: {stats.failed}</span>
            </div>
            <div className="row">
              <button onClick={handleRetryFailed} disabled={busy || stats.failed === 0}>
                Retry failed
              </button>
              <button onClick={handleClearFailed} disabled={stats.failed === 0}>
                Clear failed entries
              </button>
            </div>
          </section>

          <section className="panel">
            <h2>Activity</h2>
            <ul className="activity">
              {activity.length === 0 && <li className="muted">No activity yet.</li>}
              {activity.map((item) => (
                <li key={item.id} className={item.level}>
                  <time>{new Date(item.ts).toLocaleTimeString()}</time>
                  <span>{item.message}</span>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}
