import { AppError, ValidationError } from "@/lib/errors";
import {
  buildDiscordWebhookPayload,
  discordErrorMessage,
  discordWaitUrl,
  type DiscordNotificationEvent,
} from "@/lib/discord-embed";

export type NotificationEvent = DiscordNotificationEvent;

export interface NotificationProvider {
  readonly type: string;
  send(event: NotificationEvent, config: Record<string, unknown>): Promise<void>;
}

export const notificationRegistry = new Map<string, NotificationProvider>();

export function registerNotificationProvider(provider: NotificationProvider) {
  notificationRegistry.set(provider.type, provider);
}

const WEBHOOK_TIMEOUT_MS = 12_000;

async function postJson(url: string, body: unknown): Promise<void> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "request failed";
    throw new AppError(502, `Webhook request failed: ${reason}`, "WEBHOOK_ERROR");
  }
  if (response.ok) return;
  const text = await response.text().catch(() => "");
  throw new AppError(502, discordErrorMessage(response.status, text), "WEBHOOK_ERROR");
}

export const discordProvider: NotificationProvider = {
  type: "discord",
  async send(event, config) {
    const url = String(config.url ?? "").trim();
    if (!url) return;
    let endpoint: string;
    try {
      endpoint = discordWaitUrl(url);
    } catch {
      throw new ValidationError("Invalid webhook URL");
    }
    await postJson(endpoint, buildDiscordWebhookPayload(event));
  },
};

export const webhookProvider: NotificationProvider = {
  type: "webhook",
  async send(event, config) {
    const url = String(config.url ?? "").trim();
    if (!url) return;
    await postJson(url, event);
  },
};

registerNotificationProvider(discordProvider);
registerNotificationProvider(webhookProvider);
