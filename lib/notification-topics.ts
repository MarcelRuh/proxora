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
] as const;

export type NotificationTopic = (typeof NOTIFICATION_TOPICS)[number];

export function isNotificationTopic(value: unknown): value is NotificationTopic {
  return typeof value === "string" && (NOTIFICATION_TOPICS as readonly string[]).includes(value);
}

export function parseNotificationEvents(value: unknown): NotificationTopic[] | null {
  if (!Array.isArray(value)) return null;
  return value.filter(isNotificationTopic);
}

/** `null` / missing list = all topics (legacy channels). Empty list = nothing. */
export function channelAllowsTopic(events: NotificationTopic[] | null | undefined, topic: NotificationTopic): boolean {
  if (events == null) return true;
  if (events.includes(topic)) return true;
  // Failures used to ride on backup.started; keep existing Discord filters working.
  return topic === "backup.failed" && events.includes("backup.started");
}

export function eventsFromConfig(config: Record<string, unknown>): NotificationTopic[] | null {
  return parseNotificationEvents(config.events);
}
