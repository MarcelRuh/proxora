export const NOTIFICATION_TOPICS = [
  "host.online",
  "host.offline",
  "host.updates",
  "vm.created",
  "lxc.created",
  "vm.deleted",
  "lxc.deleted",
  "backup.started",
  "backup.failed",
  "backup.restored",
  "task.failed",
  "disk.full",
  "zfs.degraded",
] as const;

export type NotificationTopic = (typeof NOTIFICATION_TOPICS)[number];

/** Topics that existed before auto-merge of newly introduced events. */
export const LEGACY_EVENTS_SEEN: NotificationTopic[] = [
  "host.online",
  "host.offline",
  "host.updates",
  "vm.created",
  "lxc.created",
  "vm.deleted",
  "lxc.deleted",
  "backup.started",
  "backup.failed",
  "backup.restored",
  "task.failed",
];

export function isNotificationTopic(value: unknown): value is NotificationTopic {
  return typeof value === "string" && (NOTIFICATION_TOPICS as readonly string[]).includes(value);
}

export function parseNotificationEvents(value: unknown): NotificationTopic[] | null {
  if (!Array.isArray(value)) return null;
  return value.filter(isNotificationTopic);
}

export function parseEventsSeen(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  return value.filter((item): item is string => typeof item === "string");
}

export function eventsSeenFromConfig(config: Record<string, unknown>): string[] {
  return parseEventsSeen(config.eventsSeen) ?? LEGACY_EVENTS_SEEN;
}

/** Topics added after the channel was last saved are included until the user unchecks them. */
export function eventsWithNewTopics(
  events: NotificationTopic[] | null,
  eventsSeen: string[] | null | undefined = LEGACY_EVENTS_SEEN,
): NotificationTopic[] | null {
  if (events == null) return null;
  const seen = eventsSeen ?? LEGACY_EVENTS_SEEN;
  const extra = NOTIFICATION_TOPICS.filter((topic) => !seen.includes(topic));
  return [...new Set([...events, ...extra])];
}

/** `null` / missing list = all topics (legacy channels). Empty list = nothing. */
export function channelAllowsTopic(
  events: NotificationTopic[] | null | undefined,
  topic: NotificationTopic,
  eventsSeen: string[] | null | undefined = LEGACY_EVENTS_SEEN,
): boolean {
  if (events == null) return true;
  if (events.includes(topic)) return true;
  // Failures used to ride on backup.started; keep existing Discord filters working.
  if (topic === "backup.failed" && events.includes("backup.started")) return true;
  const seen = eventsSeen ?? LEGACY_EVENTS_SEEN;
  return !seen.includes(topic);
}

export function eventsFromConfig(config: Record<string, unknown>): NotificationTopic[] | null {
  return parseNotificationEvents(config.events);
}

export function configWithEvents(config: Record<string, unknown>, events: NotificationTopic[] | undefined): Record<string, unknown> {
  const next = { ...config };
  if (events !== undefined) {
    next.events = events;
    next.eventsSeen = [...NOTIFICATION_TOPICS];
  }
  return next;
}
