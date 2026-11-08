import { notifyTopic } from "@/server/notifications/dispatch";

/** peerId → last notified unreachable reason (cleared when OK again). */
const notifiedUnreachable = new Map<string, string>();
/** Self-update error detail already notified this process lifetime. */
let lastSelfUpdateErrorKey: string | null = null;

export function notifyWireguardUnreachable(
  rows: Array<{ peerId: string; name: string; ok: boolean; error: string | null; url: string }>,
): number {
  let count = 0;
  const live = new Set(rows.map((row) => row.peerId));
  for (const key of [...notifiedUnreachable.keys()]) {
    if (!live.has(key)) notifiedUnreachable.delete(key);
  }
  for (const row of rows) {
    if (row.ok) {
      notifiedUnreachable.delete(row.peerId);
      continue;
    }
    const reason = (row.error || "unreachable").slice(0, 200);
    if (notifiedUnreachable.get(row.peerId) === reason) continue;
    notifiedUnreachable.set(row.peerId, reason);
    count += 1;
    notifyTopic("wireguard.peer.unreachable", {
      level: "warning",
      title: "WireGuard-Peer unerreichbar",
      message: `${row.name}: Health-Check fehlgeschlagen (${reason})${row.url ? ` — ${row.url}` : ""}`,
      name: row.name,
      host: row.name,
    });
  }
  return count;
}

export function maybeNotifySelfUpdateFailed(progress: { step: string; detail: string | null } | null): void {
  if (!progress || progress.step !== "error") {
    if (!progress || progress.step === "done" || progress.step === "start") {
      lastSelfUpdateErrorKey = null;
    }
    return;
  }
  const key = (progress.detail || "self-update failed").slice(0, 240);
  if (lastSelfUpdateErrorKey === key) return;
  lastSelfUpdateErrorKey = key;
  notifyTopic("proxora.update.failed", {
    level: "error",
    title: "Self-Update fehlgeschlagen",
    message: key,
    name: "Proxora",
  });
}

export function clearWireguardUnreachableState(): void {
  notifiedUnreachable.clear();
}
