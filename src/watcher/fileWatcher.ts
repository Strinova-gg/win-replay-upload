import { useEffect, useRef } from 'react';
import { bridge } from '../bridge/bridge';

export interface WatcherCallbacks {
  onFile: (filePath: string) => void;
}

/**
 * Subscribes to file events from the main-process chokidar watcher. The actual
 * watcher lives in the bun (main) process (Windows-only); this hook wires the
 * RPC event into React.
 */
export function useFileWatcher({ onFile }: WatcherCallbacks): void {
  const ref = useRef(onFile);
  ref.current = onFile;

  useEffect(() => {
    const off = bridge().watcher.onFile((p) => ref.current(p));
    return off;
  }, []);
}

export const watcher = {
  start: (dir?: string) => bridge().watcher.start(dir),
  stop: () => bridge().watcher.stop(),
  scan: (dir?: string) => bridge().watcher.scan(dir),
};
