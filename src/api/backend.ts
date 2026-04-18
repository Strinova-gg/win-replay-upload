const BACKEND_URL = (process.env.BACKEND_URL ?? '').replace(/\/$/, '');

export interface PresignResponse {
  /** Pre-signed URL to PUT the file to. */
  uploadUrl: string;
  /** Optional headers required when PUTting to the URL. */
  headers?: Record<string, string>;
  /** HTTP method to use; defaults to PUT. */
  method?: 'PUT' | 'POST';
}

export class BackendError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'BackendError';
  }
}

export async function requestPresignedUrl(
  fileName: string,
  token: string,
): Promise<PresignResponse> {
  if (!BACKEND_URL) {
    throw new BackendError('BACKEND_URL is not configured', 0);
  }
  const res = await fetch(`${BACKEND_URL}/replays/presign`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ fileName }),
  });
  if (!res.ok) {
    let message = `Backend responded with ${res.status}`;
    try {
      const data = (await res.json()) as { message?: string };
      if (data?.message) message = data.message;
    } catch {
      // ignore parse errors
    }
    throw new BackendError(message, res.status);
  }
  return (await res.json()) as PresignResponse;
}
