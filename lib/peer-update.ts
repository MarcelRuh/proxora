export const PEER_UPDATE_TTL_MS = 20 * 60 * 1000;
export const PEER_UPDATE_LAST_ERROR = "Proxora update in progress";

export function isPeerUpdating(updatingUntil: Date | null | undefined, now = new Date()): boolean {
  return Boolean(updatingUntil && updatingUntil.getTime() > now.getTime());
}

export function peerUpdateDeadline(now = new Date(), ttlMs = PEER_UPDATE_TTL_MS): Date {
  return new Date(now.getTime() + ttlMs);
}

export function formatPeerUpdateRange(from?: string | null, to?: string | null): string {
  const a = from?.trim() ?? "";
  const b = to?.trim() ?? "";
  if (a && b && a !== b) return `${a} → ${b}`;
  return b || a;
}

export function peerUpdateRangeSuffix(from?: string | null, to?: string | null): string {
  const range = formatPeerUpdateRange(from, to);
  return range ? ` (${range})` : "";
}

export function shouldSkipPeerOfflineNotify(input: {
  origin: "LOCAL" | "PEER";
  updatingUntil: Date | null | undefined;
  now?: Date;
}): boolean {
  return input.origin === "PEER" && isPeerUpdating(input.updatingUntil, input.now);
}
