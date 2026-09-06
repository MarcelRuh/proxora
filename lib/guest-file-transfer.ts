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

export function isAbortError(error: unknown): boolean {
  return (error instanceof DOMException && error.name === "AbortError") || (error instanceof Error && error.name === "AbortError");
}
