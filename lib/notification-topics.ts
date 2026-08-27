export const NOTIFICATION_TOPICS = [
  "host.online",
  "host.offline",
  "host.updates",
  "vm.created",
  "lxc.created",
  "vm.deleted",
  "lxc.deleted",
  "backup.started",
  "backup.restored",
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
  return events.includes(topic);
}

export function eventsFromConfig(config: Record<string, unknown>): NotificationTopic[] | null {
  return parseNotificationEvents(config.events);
}
