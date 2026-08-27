import { ValidationError } from "@/lib/errors";
import { TEST_NOTIFICATION_EVENT } from "@/lib/discord-embed";
import { notificationRegistry } from "@/server/notifications/providers";

export async function sendNotificationTest(type: string, config: Record<string, unknown>): Promise<void> {
  const provider = notificationRegistry.get(type);
  if (!provider) throw new ValidationError(`Unknown channel type: ${type}`);
  const url = String(config.url ?? "").trim();
  if (!url) throw new ValidationError("Webhook URL is missing");
  await provider.send(TEST_NOTIFICATION_EVENT, { ...config, url });
}
