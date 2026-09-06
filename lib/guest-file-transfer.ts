import type { MessageKey } from "@/lib/i18n/messages";
import { bytesToSize } from "@/lib/utils";

export type RateSample = { bytesPerSec: number; etaSeconds: number | null };

export function createRateTracker(windowMs = 2500) {
  const samples: Array<{ t: number; n: number }> = [];
  return {
    update(sent: number, total: number, now = Date.now()): RateSample {
      samples.push({ t: now, n: sent });
      const cutoff = now - windowMs;
      while (samples.length > 1 && samples[1]!.t <= cutoff) samples.shift();
      const first = samples[0];
      const last = samples[samples.length - 1];
      if (!first || !last || last.t <= first.t + 250) {
        return { bytesPerSec: 0, etaSeconds: null };
      }
      const bytesPerSec = Math.max(0, (last.n - first.n) / ((last.t - first.t) / 1000));
      const remain = Math.max(0, total - sent);
      const etaSeconds = bytesPerSec >= 1 && remain > 0 ? remain / bytesPerSec : sent >= total && total > 0 ? 0 : null;
      return { bytesPerSec, etaSeconds };
    },
  };
}

export function formatByteRate(bytesPerSec: number, decimals = 1): string {
  if (!bytesPerSec || bytesPerSec < 1) return `0 B/s`;
  return `${bytesToSize(bytesPerSec, decimals)}/s`;
}

export function formatEtaSeconds(
  seconds: number | null,
  t: (key: MessageKey, vars?: Record<string, string | number>) => string,
): string {
  if (seconds == null || !Number.isFinite(seconds)) return t("files.etaUnknown");
  if (seconds <= 0) return t("files.etaSoon");
  if (seconds < 3) return t("files.etaSoon");
  if (seconds < 90) return t("files.etaSeconds", { n: Math.max(1, Math.round(seconds)) });
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return t("files.etaMinutes", { n: Math.max(1, minutes) });
  let h = Math.floor(seconds / 3600);
  let m = Math.round((seconds % 3600) / 60);
  if (m === 60) {
    h += 1;
    m = 0;
  }
  return t("files.etaHours", { h, m });
}

export function putBlobWithProgress(
  url: string,
  body: Blob,
  opts?: {
    onProgress?: (sent: number, total: number) => void;
    signal?: AbortSignal;
  },
): Promise<{ path?: string; name?: string; size?: number }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.withCredentials = true;
    xhr.responseType = "text";
    xhr.upload.onprogress = (event) => {
      if (!opts?.onProgress) return;
      const total = event.lengthComputable ? event.total : body.size;
      opts.onProgress(event.loaded, total || body.size);
    };
    xhr.onload = () => {
      const raw = xhr.responseText || "";
      let json: { error?: string; path?: string; name?: string; size?: number } = {};
      try {
        json = raw ? (JSON.parse(raw) as typeof json) : {};
      } catch {
        json = {};
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(json);
        return;
      }
      reject(new Error(json.error || `Upload fehlgeschlagen (${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error("Upload fehlgeschlagen"));
    xhr.onabort = () => reject(new DOMException("Aborted", "AbortError"));
    const abort = () => xhr.abort();
    if (opts?.signal) {
      if (opts.signal.aborted) {
        abort();
        return;
      }
      opts.signal.addEventListener("abort", abort, { once: true });
    }
    xhr.send(body);
  });
}

const BLOB_DOWNLOAD_MAX = 512 * 1024 * 1024;
const STREAM_TO_DISK_MIN = 8 * 1024 * 1024;

type SaveFilePicker = (options?: { suggestedName?: string }) => Promise<{
  createWritable(): Promise<{
    write(data: BufferSource | Blob | string | Uint8Array): Promise<void>;
    close(): Promise<void>;
    abort(): Promise<void>;
  }>;
}>;

function getSaveFilePicker(): SaveFilePicker | undefined {
  const picker = (window as unknown as { showSaveFilePicker?: SaveFilePicker }).showSaveFilePicker;
  return typeof picker === "function" ? picker.bind(window) : undefined;
}

export function canStreamDownloadProgress(total: number): boolean {
  return Boolean(getSaveFilePicker()) || total <= BLOB_DOWNLOAD_MAX;
}

async function pumpStream(
  body: ReadableStream<Uint8Array>,
  write: (chunk: Uint8Array) => Promise<void> | void,
  total: number,
  onProgress?: (sent: number, total: number) => void,
  signal?: AbortSignal,
): Promise<number> {
  const reader = body.getReader();
  let sent = 0;
  onProgress?.(0, total);
  try {
    while (true) {
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      const { done, value } = await reader.read();
      if (done) break;
      if (value?.byteLength) {
        await write(value);
        sent += value.byteLength;
        onProgress?.(sent, total || sent);
      }
    }
    onProgress?.(sent, total || sent);
    return sent;
  } finally {
    reader.releaseLock();
  }
}

/** Streams a download to disk (File System Access) or a blob; returns "browser" if the native download should be used. */
export async function saveUrlWithProgress(
  url: string,
  name: string,
  total: number,
  opts?: {
    onProgress?: (sent: number, total: number) => void;
    signal?: AbortSignal;
  },
): Promise<"saved" | "browser"> {
  const picker = getSaveFilePicker();
  if (picker && total > STREAM_TO_DISK_MIN) {
    const handle = await picker({ suggestedName: name });
    const response = await fetch(url, { credentials: "include", signal: opts?.signal });
    if (!response.ok || !response.body) {
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      throw new Error(data.error || `Download fehlgeschlagen (${response.status})`);
    }
    const size = Number(response.headers.get("content-length")) || total;
    const writable = await handle.createWritable();
    try {
      await pumpStream(response.body, (chunk) => writable.write(chunk), size, opts?.onProgress, opts?.signal);
      await writable.close();
    } catch (error) {
      try {
        await writable.abort();
      } catch {
        /* ignore */
      }
      throw error;
    }
    return "saved";
  }
  if (total > BLOB_DOWNLOAD_MAX) return "browser";
  const response = await fetch(url, { credentials: "include", signal: opts?.signal });
  if (!response.ok || !response.body) {
    const data = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error || `Download fehlgeschlagen (${response.status})`);
  }
  const size = Number(response.headers.get("content-length")) || total;
  const chunks: Uint8Array[] = [];
  await pumpStream(
    response.body,
    (chunk) => {
      chunks.push(chunk);
    },
    size,
    opts?.onProgress,
    opts?.signal,
  );
  const bytes = new Uint8Array(chunks.reduce((n, c) => n + c.byteLength, 0));
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const href = URL.createObjectURL(new Blob([bytes]));
  const a = document.createElement("a");
  a.href = href;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(href);
  return "saved";
}

export function triggerBrowserDownload(url: string, name: string) {
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export function isAbortError(error: unknown): boolean {
  return (error instanceof DOMException && error.name === "AbortError") || (error instanceof Error && error.name === "AbortError");
}
