import { BackendError, requestUploadUrl, type SignedUploadResponse } from "../api/backend";
import { bridge } from "../bridge/bridge";

export type UploadOutcome =
  | { kind: "uploaded" }
  | { kind: "already-uploaded"; httpStatus: number }
  | { kind: "failed"; error: string; httpStatus?: number };

export interface UploadInput {
  /** Absolute path on disk, used to read replay bytes via IPC. */
  filePath: string;
  /** Replay filename only, sent to the upload API. */
  fileName: string;
  /** Returns a fresh OAuth access token for the backend. */
  getToken: () => Promise<string | null>;
}

async function putFile(upload: SignedUploadResponse, bytes: ArrayBuffer): Promise<Response> {
  return fetch(upload.uploadUrl, {
    method: upload.method ?? "PUT",
    headers: {
      "Content-Type": "application/octet-stream",
      ...(upload.headers ?? {}),
    },
    body: bytes,
  });
}

export async function uploadReplay(input: UploadInput): Promise<UploadOutcome> {
  const { filePath, fileName, getToken } = input;
  const token = await getToken();
  if (!token) {
    return { kind: "failed", error: "Not signed in (no OAuth access token)" };
  }

  let bytes: ArrayBuffer;
  try {
    bytes = await bridge().file.read(filePath);
  } catch (err) {
    return { kind: "failed", error: `Could not read file: ${(err as Error).message}` };
  }

  let upload: SignedUploadResponse;
  try {
    upload = await requestUploadUrl(fileName, bytes.byteLength, token);
  } catch (err) {
    if (err instanceof BackendError) {
      if (err.status === 403) {
        return { kind: "already-uploaded", httpStatus: 403 };
      }
      return { kind: "failed", error: err.message, httpStatus: err.status };
    }
    return { kind: "failed", error: (err as Error).message };
  }

  let response: Response;
  try {
    response = await putFile(upload, bytes);
  } catch (err) {
    return { kind: "failed", error: `Network error during upload: ${(err as Error).message}` };
  }

  if (response.ok) return { kind: "uploaded" };
  if (response.status === 403) {
    return { kind: "already-uploaded", httpStatus: 403 };
  }

  return {
    kind: "failed",
    error: `Upload responded with ${response.status} ${response.statusText}`,
    httpStatus: response.status,
  };
}
