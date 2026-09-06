/** True for guest file stream routes that must not pass Next.js proxy (it clones the body). */
export function isGuestFileTransferPath(pathname: string): boolean {
  const path = (pathname.split("?")[0] ?? "").replace(/\/+$/, "") || "/";
  return /\/files\/(upload|download)$/.test(path) || /\/guest-files\/(upload|download)$/.test(path);
}
