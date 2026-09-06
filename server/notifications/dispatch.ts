import { decryptSecret } from "@/lib/crypto";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import {
  notificationRegistry,
  type NotificationEvent,
} from "@/server/notifications/providers";
import {
  channelAllowsTopic,
  eventsFromConfig,
  eventsSeenFromConfig,
  isNotificationTopic,
  type NotificationTopic,
} from "@/lib/notification-topics";
import { recordInboxEvent } from "@/server/services/inbox-service";
import { sendInboxPush } from "@/server/services/push-service";

export async function dispatchNotification(event: NotificationEvent): Promise<void> {
  const row = await recordInboxEvent(event).catch((error) => {
    logger.warn({ err: error, topic: event.topic }, "Inbox persist failed");
    return null;
  });
  if (row) {
    await sendInboxPush(row).catch((error) => {
      logger.warn({ err: error, topic: event.topic }, "Inbox push failed");
    });
  }
  const channels = await prisma.notificationChannel.findMany({ where: { enabled: true } });
  if (channels.length === 0) return;
  await Promise.all(
    channels.map(async (channel) => {
      const provider = notificationRegistry.get(channel.type);
      if (!provider) return;
      try {
        const config = JSON.parse(decryptSecret(channel.config)) as Record<string, unknown>;
        if (
          isNotificationTopic(event.topic) &&
          !channelAllowsTopic(eventsFromConfig(config), event.topic, eventsSeenFromConfig(config))
        ) {
          return;
        }
        await provider.send(event, config);
      } catch (error) {
        logger.warn(
          { channelId: channel.id, type: channel.type, err: error instanceof Error ? error.message : error },
          "Notification delivery failed",
        );
      }
    }),
  );
}

export function notifyTopic(
  topic: NotificationTopic,
  event: Omit<NotificationEvent, "topic">,
): void {
  void dispatchNotification({ ...event, topic }).catch((error) => {
    logger.warn({ err: error, topic }, "Notification dispatch failed");
  });
}
