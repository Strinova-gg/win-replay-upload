import { Utils } from "electrobun/bun";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { AppSettings } from "../shared/types";

const SETTINGS_FILE = "settings.json";

const DEFAULT_SETTINGS: AppSettings = {
  autoSyncEnabled: true,
  watchDir: null,
};

function sanitizeSettings(value: unknown): AppSettings {
  if (!value || typeof value !== "object") {
    return { ...DEFAULT_SETTINGS };
  }

  const candidate = value as Partial<AppSettings>;

  return {
    autoSyncEnabled:
      typeof candidate.autoSyncEnabled === "boolean"
        ? candidate.autoSyncEnabled
        : DEFAULT_SETTINGS.autoSyncEnabled,
    watchDir: typeof candidate.watchDir === "string" ? candidate.watchDir : null,
  };
}

class AppSettingsStore {
  private cache: AppSettings = { ...DEFAULT_SETTINGS };

  private get path(): string {
    const dir = Utils.paths.userData;
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    return join(dir, SETTINGS_FILE);
  }

  async init(): Promise<void> {
    const file = Bun.file(this.path);
    if (!(await file.exists())) {
      return;
    }

    try {
      this.cache = sanitizeSettings(await file.json());
    } catch {
      this.cache = { ...DEFAULT_SETTINGS };
    }
  }

  private async persist(): Promise<void> {
    await Bun.write(this.path, JSON.stringify(this.cache, null, 2));
  }

  get(): AppSettings {
    return { ...this.cache };
  }

  set(patch: Partial<AppSettings>): AppSettings {
    this.cache = sanitizeSettings({
      ...this.cache,
      ...patch,
    });
    void this.persist();
    return this.get();
  }
}

export const appSettings = new AppSettingsStore();

await appSettings.init();
