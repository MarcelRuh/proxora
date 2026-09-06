export const GUEST_FILE_UPLOAD_WS_PATH = "/ws/guest-file";
export const GUEST_UPLOAD_SIZE_HEADER = "x-proxora-upload-size";
export const GUEST_UPLOAD_OFFSET_HEADER = "x-proxora-upload-offset";

function parseUnsignedHeader(raw: string | null | undefined): number | null {
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > Number.MAX_SAFE_INTEGER) return null;
  return Math.floor(n);
}

/** Total dest size and resume offset for a PUT/WS upload. */
export function parseGuestUploadPlan(input: {
  sizeHeader?: string | null;
  offsetHeader?: string | null;
  contentLength?: string | null;
}): { offset: number; expectedSize: number | null } {
  const offset = parseUnsignedHeader(input.offsetHeader) ?? 0;
  const size = parseUnsignedHeader(input.sizeHeader);
  const length = parseUnsignedHeader(input.contentLength);
  if (size != null) return { offset, expectedSize: size };
  if (length != null) return { offset, expectedSize: offset + length };
  return { offset, expectedSize: null };
}

/** True for guest file stream routes that must not pass Next.js proxy (it clones the body). */
export function isGuestFileTransferPath(pathname: string): boolean {
  const path = (pathname.split("?")[0] ?? "").replace(/\/+$/, "") || "/";
  return /\/files\/(upload|download)$/.test(path) || /\/guest-files\/(upload|download)$/.test(path);
}

export function isGuestFileUploadWsPath(pathname: string): boolean {
  const path = (pathname.split("?")[0] ?? "").replace(/\/+$/, "") || "/";
  return path === GUEST_FILE_UPLOAD_WS_PATH;
}

/** Browser Origin (`https://host`) → `wss://host/ws/guest-file?ticket=`. */
export function guestFileUploadWsUrl(ticket: string, origin: string): string {
  const url = new URL(GUEST_FILE_UPLOAD_WS_PATH, origin);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.search = "";
  url.searchParams.set("ticket", ticket);
  url.hash = "";
  return url.toString();
}
