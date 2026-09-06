export type InboxNotifyItem = {
  id: string;
  read?: boolean;
};

export type InboxNotifyPlan<T extends InboxNotifyItem> = {
  lastSeenId: string | null;
  items: T[];
  overflow: number;
};

const MAX_INDIVIDUAL = 5;

/** `events` must be newest-first, matching GET /api/inbox. */
export function inboxNotifyPlan<T extends InboxNotifyItem>(
  events: T[],
  lastSeenId: string | null,
): InboxNotifyPlan<T> {
  if (events.length === 0) return { lastSeenId, items: [], overflow: 0 };
  const newestId = events[0]!.id;
  if (!lastSeenId) return { lastSeenId: newestId, items: [], overflow: 0 };

  const fresh: T[] = [];
  let found = false;
  for (const row of events) {
    if (row.id === lastSeenId) {
      found = true;
      break;
    }
    if (!row.read) fresh.push(row);
  }
  if (!found) {
    return { lastSeenId: newestId, items: [], overflow: fresh.length };
  }
  if (fresh.length === 0) return { lastSeenId: newestId, items: [], overflow: 0 };
  return {
    lastSeenId: newestId,
    items: fresh.slice(0, MAX_INDIVIDUAL),
    overflow: Math.max(0, fresh.length - MAX_INDIVIDUAL),
  };
}
