import { Utils } from "electrobun/bun";
import { mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { LogEntry } from "../shared/types";

const LOG_FILE = "upload-log.json";

class UploadLog {
  private cache: Record<string, LogEntry> = {};

  private get path(): string {
    const dir = Utils.paths.userData;
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    return join(dir, LOG_FILE);
  }

  async init(): Promise<void> {
    const file = Bun.file(this.path);
    if (await file.exists()) {
      try {
        this.cache = (await file.json()) as Record<string, LogEntry>;
      } catch {
        this.cache = {};
      }
    }
  }

  private async persist(): Promise<void> {
    await Bun.write(this.path, JSON.stringify(this.cache, null, 2));
  }

  all(): Record<string, LogEntry> {
    return this.cache;
  }

  statusOf(name: string): LogEntry | null {
    return this.cache[name] ?? null;
  }

  set(name: string, entry: LogEntry): void {
    this.cache[name] = entry;
    void this.persist();
  }

  clearFailed(): number {
    let removed = 0;
    for (const [k, v] of Object.entries(this.cache)) {
      if (v.status === "failed") {
        delete this.cache[k];
        removed += 1;
      }
    }
    void this.persist();
    return removed;
  }

  async exportTo(filePath: string): Promise<void> {
    await Bun.write(filePath, JSON.stringify(this.cache, null, 2));
  }
}

export const uploadLog = new UploadLog();

// Hydrate the persisted log at module load time.
await uploadLog.init();
