import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SignedIn, SignedOut, SignIn, UserButton } from '@clerk/clerk-react';
import { useClerkToken } from '../auth/clerk';
import { uploadReplay } from '../uploader/uploader';
import { log, shouldSkip, type LogEntry } from '../log/uploadLog';
import { watcher, useFileWatcher } from '../watcher/fileWatcher';
import { bridge } from '../bridge/bridge';
import { LogTable } from './LogTable';

interface PlatformInfo {
  platform: NodeJS.Platform;
  isWindows: boolean;
  defaultWatchDir: string;
}

type Activity = { id: string; ts: number; level: 'info' | 'warn' | 'error'; message: string };

function basename(p: string): string {
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  return i >= 0 ? p.slice(i + 1) : p;
}

export function App() {
  const getToken = useClerkToken();
  const [platform, setPlatform] = useState<PlatformInfo | null>(null);
  const [watchDir, setWatchDir] = useState<string>('');
  const [watching, setWatching] = useState(false);
  const [entries, setEntries] = useState<Record<string, LogEntry>>({});
  const [activity, setActivity] = useState<Activity[]>([]);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef<Set<string>>(new Set());

  const pushActivity = useCallback((level: Activity['level'], message: string) => {
    setActivity((prev) =>
      [{ id: crypto.randomUUID(), ts: Date.now(), level, message }, ...prev].slice(0, 200),
    );
  }, []);

  const refreshLog = useCallback(async () => {
    setEntries(await log.all());
  }, []);

  useEffect(() => {
    (async () => {
      const info = await bridge().platform();
      setPlatform(info);
      setWatchDir(info.defaultWatchDir);
      await refreshLog();
    })();
  }, [refreshLog]);

  const processFile = useCallback(
    async (filePath: string) => {
      const fileName = basename(filePath);
      if (inFlight.current.has(fileName)) return;

      const existing = await log.statusOf(fileName);
      if (shouldSkip(existing)) {
        pushActivity('info', `Skipping ${fileName} (${existing!.status}).`);
        return;
      }

      inFlight.current.add(fileName);
      pushActivity('info', `Uploading ${fileName}…`);

      const outcome = await uploadReplay({ filePath, fileName, getToken });
      const at = new Date().toISOString();

      let entry: LogEntry;
      if (outcome.kind === 'uploaded') {
        entry = { status: 'uploaded', at };
        pushActivity('info', `Uploaded ${fileName}.`);
      } else if (outcome.kind === 'already-uploaded') {
        entry = { status: 'already-uploaded', at, httpStatus: outcome.httpStatus };
        pushActivity('warn', `${fileName} already uploaded (403). Will not retry.`);
      } else {
        entry = {
          status: 'failed',
          at,
          error: outcome.error,
          httpStatus: outcome.httpStatus,
        };
        pushActivity('error', `Failed ${fileName}: ${outcome.error}`);
      }

      await log.record(fileName, entry);
      await refreshLog();
      inFlight.current.delete(fileName);
    },
    [getToken, pushActivity, refreshLog],
  );

  useFileWatcher({ onFile: processFile });

  const handleStartWatch = useCallback(async () => {
    if (!platform?.isWindows) return;
    try {
      const res = await watcher.start(watchDir);
      setWatching(res.watching);
      pushActivity('info', `Watching ${res.dir}.`);
    } catch (err) {
      pushActivity('error', (err as Error).message);
    }
  }, [platform, watchDir, pushActivity]);

  const handleStopWatch = useCallback(async () => {
    await watcher.stop();
    setWatching(false);
    pushActivity('info', 'Stopped watcher.');
  }, [pushActivity]);

  const handleManualSync = useCallback(async () => {
    setBusy(true);
    try {
      const dir = watchDir;
      pushActivity('info', `Scanning ${dir}…`);
      const files = await watcher.scan(dir);
      pushActivity('info', `Found ${files.length} replay file(s).`);
      for (const file of files) {
        await processFile(file);
      }
    } finally {
      setBusy(false);
    }
  }, [watchDir, pushActivity, processFile]);

  const handlePickFolder = useCallback(async () => {
    const dir = await bridge().dialog.pickFolder();
    if (dir) setWatchDir(dir);
  }, []);

  const handlePickFiles = useCallback(async () => {
    const files = await bridge().dialog.pickReplays();
    setBusy(true);
    try {
      for (const file of files) {
        await processFile(file);
      }
    } finally {
      setBusy(false);
    }
  }, [processFile]);

  const handleClearFailed = useCallback(async () => {
    const removed = await log.clearFailed();
    pushActivity('info', `Cleared ${removed} failed entr${removed === 1 ? 'y' : 'ies'}.`);
    await refreshLog();
  }, [pushActivity, refreshLog]);

  const handleRetryFailed = useCallback(async () => {
    setBusy(true);
    try {
      const failed = Object.entries(entries).filter(([, v]) => v.status === 'failed');
      pushActivity('info', `Retrying ${failed.length} failed file(s).`);
      // We only have file names in the log; re-scan watch dir to resolve paths.
      const known = new Map<string, string>();
      const scanned = await watcher.scan(watchDir);
      for (const p of scanned) known.set(basename(p), p);
      for (const [name] of failed) {
        const path = known.get(name);
        if (!path) {
          pushActivity('warn', `Cannot retry ${name}: not found in ${watchDir}.`);
          continue;
        }
        // Force retry by clearing existing entry first.
        await log.record(name, {
          status: 'failed',
          at: new Date().toISOString(),
          error: 'retrying',
        });
        // Bypass shouldSkip (failed entries aren't skipped anyway).
        await processFile(path);
      }
    } finally {
      setBusy(false);
    }
  }, [entries, watchDir, processFile, pushActivity]);

  const handleExport = useCallback(async () => {
    const path = await log.export();
    if (path) pushActivity('info', `Exported log to ${path}.`);
  }, [pushActivity]);

  const stats = useMemo(() => {
    let uploaded = 0;
    let already = 0;
    let failed = 0;
    for (const v of Object.values(entries)) {
      if (v.status === 'uploaded') uploaded++;
      else if (v.status === 'already-uploaded') already++;
      else if (v.status === 'failed') failed++;
    }
    return { uploaded, already, failed, total: uploaded + already + failed };
  }, [entries]);

  return (
    <div className="app">
      <header className="topbar">
        <h1>Strinova Replay Uploader</h1>
        <div className="auth">
          <SignedIn>
            <UserButton />
          </SignedIn>
        </div>
      </header>

      <SignedOut>
        <div className="signin">
          <SignIn routing="virtual" />
        </div>
      </SignedOut>

      <SignedIn>
        {platform && !platform.isWindows && (
          <div className="notice warn">
            Folder watching is disabled on <strong>{platform.platform}</strong> — only Windows is
            supported. You can still manually pick replay files or a folder to sync.
          </div>
        )}

        <section className="panel">
          <h2>Folder</h2>
          <div className="row">
            <input
              type="text"
              value={watchDir}
              onChange={(e) => setWatchDir(e.target.value)}
              spellCheck={false}
            />
            <button onClick={handlePickFolder}>Choose folder…</button>
          </div>
          <div className="row">
            {platform?.isWindows ? (
              watching ? (
                <button onClick={handleStopWatch}>Stop watching</button>
              ) : (
                <button onClick={handleStartWatch}>Start watching</button>
              )
            ) : (
              <button disabled title="Watching is Windows-only">
                Start watching (Windows only)
              </button>
            )}
            <button onClick={handleManualSync} disabled={busy}>
              {busy ? 'Working…' : 'Manual sync now'}
            </button>
            <button onClick={handlePickFiles} disabled={busy}>
              Pick .replay file(s)…
            </button>
          </div>
          <div className="status">
            Watcher: <strong>{watching ? 'on' : 'off'}</strong>
          </div>
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
            <button onClick={handleExport}>Export log…</button>
          </div>
        </section>

        <section className="panel">
          <h2>Activity</h2>
          <ul className="activity">
            {activity.length === 0 && <li className="muted">No activity yet.</li>}
            {activity.map((a) => (
              <li key={a.id} className={a.level}>
                <time>{new Date(a.ts).toLocaleTimeString()}</time>
                <span>{a.message}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="panel">
          <h2>Upload log</h2>
          <LogTable entries={entries} />
        </section>
      </SignedIn>
    </div>
  );
}
