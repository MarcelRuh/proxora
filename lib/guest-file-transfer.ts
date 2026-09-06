import type { MessageKey } from "@/lib/i18n/messages";
import { guestFileUploadWsUrl } from "@/lib/guest-file-http";
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

const WS_UPLOAD_MIN_BYTES = 512 * 1024;
const WS_BUFFER_HIGH = 8 * 1024 * 1024;
const WS_HANDSHAKE_MS = 20_000;

function ticketFromUploadUrl(url: string): string {
  try {
    return new URL(url, "http://localhost").searchParams.get("ticket")?.trim() ?? "";
  } catch {
    return "";
  }
}

function putBlobOverXhr(
  url: string,
  body: Blob,
  opts?: {
    onProgress?: (sent: number, total: number) => void;
    signal?: AbortSignal;
    offset?: number;
    total?: number;
  },
): Promise<{ path?: string; name?: string; size?: number }> {
  const offset = opts?.offset ?? 0;
  const total = opts?.total ?? body.size + offset;
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.withCredentials = true;
    xhr.responseType = "text";
    xhr.setRequestHeader("x-proxora-upload-size", String(total));
    xhr.setRequestHeader("x-proxora-upload-offset", String(offset));
    xhr.upload.onprogress = (event) => {
      if (!opts?.onProgress) return;
      const loaded = event.loaded;
      opts.onProgress(offset + loaded, total);
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

class GuestUploadWsError extends Error {
  constructor() {
    super("UPLOAD_WS");
    this.name = "GuestUploadWsError";
  }
}

export function isGuestUploadWsError(error: unknown): boolean {
  return error instanceof Error && error.name === "GuestUploadWsError";
}

class WsHandshakeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WsHandshakeError";
  }
}

async function waitWsBuffered(ws: WebSocket, signal?: AbortSignal) {
  while (ws.readyState === WebSocket.OPEN && ws.bufferedAmount > WS_BUFFER_HIGH) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    await new Promise((r) => setTimeout(r, 20));
  }
}

function putBlobOverWebSocket(
  ticket: string,
  body: Blob,
  opts?: {
    onProgress?: (sent: number, total: number) => void;
    signal?: AbortSignal;
    offset?: number;
    total?: number;
  },
): Promise<{ path?: string; name?: string; size?: number }> {
  const origin = globalThis.location?.origin;
  if (!origin || typeof WebSocket === "undefined" || typeof body.stream !== "function") {
    return Promise.reject(new WsHandshakeError("No WebSocket"));
  }
  const offset = opts?.offset ?? 0;
  const total = opts?.total ?? body.size + offset;
  const url = guestFileUploadWsUrl(ticket, origin);
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.binaryType = "arraybuffer";
    let settled = false;
    let pumping = false;
    const handshake = setTimeout(() => {
      if (!pumping) fail(new WsHandshakeError("WebSocket handshake timeout"));
    }, WS_HANDSHAKE_MS);

    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(handshake);
      try {
        ws.close();
      } catch {
        /* ignore */
      }
      reject(error instanceof Error ? error : new Error(String(error)));
    };

    const abort = () => fail(new DOMException("Aborted", "AbortError"));
    if (opts?.signal) {
      if (opts.signal.aborted) {
        abort();
        return;
      }
      opts.signal.addEventListener("abort", abort, { once: true });
    }

    ws.onerror = () => {
      fail(pumping ? new Error("Upload fehlgeschlagen") : new WsHandshakeError("WebSocket failed"));
    };
    ws.onclose = () => {
      if (!settled) fail(pumping ? new Error("Upload abgebrochen") : new WsHandshakeError("WebSocket closed"));
    };
    ws.onmessage = (event) => {
      if (typeof event.data !== "string") return;
      let msg: { type?: string; error?: string; path?: string; name?: string; size?: number } = {};
      try {
        msg = JSON.parse(event.data) as typeof msg;
      } catch {
        fail(new Error("Ungültige Server-Antwort"));
        return;
      }
      if (msg.type === "error") {
        fail(new Error(msg.error || "Upload fehlgeschlagen"));
        return;
      }
      if (msg.type === "ready") {
        if (ws.readyState !== WebSocket.OPEN) return;
        ws.send(JSON.stringify({ type: "start", size: total, offset }));
        return;
      }
      if (msg.type === "go") {
        if (pumping) return;
        pumping = true;
        clearTimeout(handshake);
        void pump();
        return;
      }
      if (msg.type === "done") {
        if (settled) return;
        settled = true;
        clearTimeout(handshake);
        opts?.onProgress?.(total, total);
        resolve({ path: msg.path, name: msg.name, size: msg.size });
        try {
          ws.close();
        } catch {
          /* ignore */
        }
      }
    };

    async function pump() {
      try {
        opts?.onProgress?.(offset, total);
        const reader = body.stream().getReader();
        let sent = 0;
        while (true) {
          if (opts?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
          if (ws.readyState !== WebSocket.OPEN) throw new Error("Upload abgebrochen");
          await waitWsBuffered(ws, opts?.signal);
          const { done, value } = await reader.read();
          if (done) break;
          if (!value?.byteLength) continue;
          ws.send(value);
          sent += value.byteLength;
          opts?.onProgress?.(Math.min(total, offset + Math.max(0, sent - ws.bufferedAmount)), total);
        }
        await waitWsBuffered(ws, opts?.signal);
        opts?.onProgress?.(total, total);
        if (ws.readyState !== WebSocket.OPEN) throw new Error("Upload abgebrochen");
        ws.send(JSON.stringify({ type: "end" }));
      } catch (error) {
        fail(error);
      }
    }
  });
}

export async function putBlobWithProgress(
  url: string,
  body: Blob,
  opts?: {
    onProgress?: (sent: number, total: number) => void;
    signal?: AbortSignal;
    offset?: number;
    total?: number;
  },
): Promise<{ path?: string; name?: string; size?: number }> {
  const ticket = ticketFromUploadUrl(url);
  const total = opts?.total ?? body.size + (opts?.offset ?? 0);
  if (ticket && total >= WS_UPLOAD_MIN_BYTES) {
    try {
      return await putBlobOverWebSocket(ticket, body, opts);
    } catch (error) {
      if (isAbortError(error)) throw error;
      if (error instanceof WsHandshakeError) throw new GuestUploadWsError();
      throw error;
    }
  }
  return putBlobOverXhr(url, body, opts);
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
