import type { NotificationTopic } from "@/lib/notification-topics";

export type NotificationEvent = {
  topic: NotificationTopic;
  level: "info" | "warning" | "error" | "success";
  title: string;
  message: string;
  hostId?: string;
};

export interface NotificationProvider {
  readonly type: string;
  send(event: NotificationEvent, config: Record<string, unknown>): Promise<void>;
}

export const notificationRegistry = new Map<string, NotificationProvider>();

export function registerNotificationProvider(provider: NotificationProvider) {
  notificationRegistry.set(provider.type, provider);
}

export const discordProvider: NotificationProvider = {
  type: "discord",
  async send(event, config) {
    const url = String(config.url ?? "");
    if (!url) return;
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: `**${event.title}**\n${event.message}`,
      }),
    });
  },
};

export const webhookProvider: NotificationProvider = {
  type: "webhook",
  async send(event, config) {
    const url = String(config.url ?? "");
    if (!url) return;
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(event),
    });
  },
};

registerNotificationProvider(discordProvider);
registerNotificationProvider(webhookProvider);
