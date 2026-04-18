import { BackendError, requestPresignedUrl, type PresignResponse } from '../api/backend';
import { bridge } from '../bridge/bridge';

export type UploadOutcome =
  | { kind: 'uploaded' }
  | { kind: 'already-uploaded'; httpStatus: number }
  | { kind: 'failed'; error: string; httpStatus?: number };

export interface UploadInput {
  /** Absolute path on disk (used to read bytes via IPC). */
  filePath: string;
  /** File name only (sent to backend / used as log key). */
  fileName: string;
  /** Returns a fresh Clerk session token. */
  getToken: () => Promise<string | null>;
}

async function putFile(presign: PresignResponse, bytes: ArrayBuffer): Promise<Response> {
  return fetch(presign.uploadUrl, {
    method: presign.method ?? 'PUT',
    headers: {
      'Content-Type': 'application/octet-stream',
      ...(presign.headers ?? {}),
    },
    body: bytes,
  });
}

export async function uploadReplay(input: UploadInput): Promise<UploadOutcome> {
  const { filePath, fileName, getToken } = input;
  const token = await getToken();
  if (!token) {
    return { kind: 'failed', error: 'Not signed in (no Clerk session token)' };
  }

  let presign: PresignResponse;
  try {
    presign = await requestPresignedUrl(fileName, token);
  } catch (err) {
    if (err instanceof BackendError) {
      if (err.status === 403) {
        return { kind: 'already-uploaded', httpStatus: 403 };
      }
      return { kind: 'failed', error: err.message, httpStatus: err.status };
    }
    return { kind: 'failed', error: (err as Error).message };
  }

  let bytes: ArrayBuffer;
  try {
    bytes = await bridge().file.read(filePath);
  } catch (err) {
    return { kind: 'failed', error: `Could not read file: ${(err as Error).message}` };
  }

  let res: Response;
  try {
    res = await putFile(presign, bytes);
  } catch (err) {
    return { kind: 'failed', error: `Network error during upload: ${(err as Error).message}` };
  }

  if (res.ok) return { kind: 'uploaded' };
  if (res.status === 403) return { kind: 'already-uploaded', httpStatus: 403 };
  return {
    kind: 'failed',
    error: `Upload responded with ${res.status} ${res.statusText}`,
    httpStatus: res.status,
  };
}
