export type ApiError = { error: string; code?: string; details?: unknown };

export class ApiRequestError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
    this.code = code;
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      headers,
      credentials: "include",
    });
  } catch (error) {
    throw new ApiRequestError(
      error instanceof Error ? error.message : "Failed to fetch",
      0,
      "network",
    );
  }
  const data = (await response.json().catch(() => ({}))) as T & ApiError;
  if (!response.ok) {
    throw new ApiRequestError(data.error || `Request failed (${response.status})`, response.status, data.code);
  }
  return data;
}

export function isNetworkFetchError(error: unknown): boolean {
  if (error instanceof ApiRequestError && (error.code === "network" || error.status === 0)) return true;
  const msg = error instanceof Error ? error.message : String(error ?? "");
  return /failed to fetch|networkerror|load failed|network request failed/i.test(msg);
}
