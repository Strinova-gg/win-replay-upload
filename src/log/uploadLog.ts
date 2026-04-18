import { bridge } from '../bridge/bridge';
import type { LogEntry, UploadStatus } from '../shared/types';

export type { LogEntry, UploadStatus };

export const log = {
  all: () => bridge().log.all(),
  statusOf: (name: string) => bridge().log.statusOf(name),
  record: (name: string, entry: LogEntry) => bridge().log.set(name, entry),
  clearFailed: () => bridge().log.clearFailed(),
  export: () => bridge().log.export(),
};

/**
 * A file should be skipped (not re-uploaded) if it was already uploaded or
 * the backend told us it was already uploaded (403). Failed entries are NOT
 * skipped so the user / app can retry.
 */
export function shouldSkip(entry: LogEntry | null | undefined): boolean {
  if (!entry) return false;
  return entry.status === 'uploaded' || entry.status === 'already-uploaded';
}
