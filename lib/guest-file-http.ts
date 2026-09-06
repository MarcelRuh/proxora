export const GUEST_FILE_UPLOAD_WS_PATH = "/ws/guest-file";

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
