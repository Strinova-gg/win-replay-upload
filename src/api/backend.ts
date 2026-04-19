const BACKEND_URL = (process.env.BACKEND_URL ?? "https://strinova.gg").replace(/\/$/, "");

export interface SignedUploadResponse {
  /** Pre-signed URL to PUT the file to. */
  uploadUrl: string;
  /** Optional headers required when PUTting to the URL. */
  headers?: Record<string, string>;
  /** HTTP method to use; defaults to PUT. */
  method?: "PUT" | "POST";
}

type UploadRouteEntry =
  | { name: string; signedUrl: string }
  | { name: string; error: string };

export class BackendError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "BackendError";
  }
}

export async function requestUploadUrl(
  fileName: string,
  fileSize: number,
  token: string,
): Promise<SignedUploadResponse> {
  const response = await fetch(`${BACKEND_URL}/api/upload`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      files: [{ name: fileName, size: fileSize }],
    }),
  });

  if (!response.ok) {
    let message = `Backend responded with ${response.status}`;
    try {
      const data = (await response.json()) as { error?: string; message?: string };
      if (data.error) message = data.error;
      else if (data.message) message = data.message;
    } catch {
      // Ignore parse failures and use the generic HTTP message.
    }
    throw new BackendError(message, response.status);
  }

  const data = (await response.json()) as {
    urls?: UploadRouteEntry[];
  };
  const firstEntry = data.urls?.[0];

  if (!firstEntry) {
    throw new BackendError("Upload API did not return a signed URL.", 502);
  }

  if ("error" in firstEntry) {
    throw new BackendError(firstEntry.error, 400);
  }

  return {
    uploadUrl: firstEntry.signedUrl,
    method: "PUT",
  };
}
