import chokidar, { type FSWatcher } from "chokidar";
import { readdir, stat } from "node:fs/promises";
import { join, extname } from "node:path";

const REPLAY_EXT = ".replay";

export class ReplayWatcher {
  private fsWatcher: FSWatcher | null = null;

  constructor(
    private readonly dir: string,
    private readonly onFile: (filePath: string) => void,
  ) {}

  async start(): Promise<void> {
    // Lightweight: depth 0, ignore initial existing files (those are surfaced
    // via scanOnce on demand), wait for writes to settle before reporting.
    this.fsWatcher = chokidar.watch(this.dir, {
      depth: 0,
      ignoreInitial: true,
      persistent: true,
      awaitWriteFinish: {
        stabilityThreshold: 5_000,
        pollInterval: 1_000,
      },
    });

    this.fsWatcher.on("add", (filePath) => {
      if (extname(filePath).toLowerCase() === REPLAY_EXT) {
        this.onFile(filePath);
      }
    });
  }

  async stop(): Promise<void> {
    await this.fsWatcher?.close();
    this.fsWatcher = null;
  }

  static async scanOnce(dir: string): Promise<string[]> {
    try {
      const entries = await readdir(dir);
      const matches: string[] = [];
      for (const name of entries) {
        if (extname(name).toLowerCase() !== REPLAY_EXT) continue;
        const full = join(dir, name);
        try {
          const s = await stat(full);
          if (s.isFile()) matches.push(full);
        } catch {
          // ignore
        }
      }
      return matches;
    } catch {
      return [];
    }
  }
}
