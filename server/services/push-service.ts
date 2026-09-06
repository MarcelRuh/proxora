import webpush from "web-push";
import { encryptSecret, decryptSecret } from "@/lib/crypto";
import { prisma } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { logger } from "@/lib/logger";
import { assertSafeWebhookUrl } from "@/lib/webhook-url";
import { PUSH_VAPID_SETTING_KEY, buildPushPayload, type PushPayload } from "@/lib/push-payload";
import { toSessionUser } from "@/server/auth/session-core";
import { userReceivesInboxPush } from "@/server/services/inbox-service";
import { broadcastPush } from "@/server/ws/push-hub";

type VapidKeys = { publicKey: string; privateKey: string };

let vapidPromise: Promise<VapidKeys> | null = null;

function vapidSubject(): string {
  const appUrl = getEnv().appUrl.trim();
  try {
    const parsed = new URL(appUrl);
    if (parsed.protocol === "https:") return parsed.origin;
  } catch {
    /* mailto fallback */
  }
  return "mailto:proxora@localhost";
}

async function loadOrCreateVapid(): Promise<VapidKeys> {
  const row = await prisma.setting.findUnique({ where: { key: PUSH_VAPID_SETTING_KEY } });
  const existing = row?.value as { publicKey?: unknown; privateKey?: unknown } | null;
  if (
    existing &&
    typeof existing.publicKey === "string" &&
    existing.publicKey.length > 20 &&
    typeof existing.privateKey === "string"
  ) {
    return { publicKey: existing.publicKey, privateKey: decryptSecret(existing.privateKey) };
  }
  const generated = webpush.generateVAPIDKeys();
  await prisma.setting.upsert({
    where: { key: PUSH_VAPID_SETTING_KEY },
    create: {
      key: PUSH_VAPID_SETTING_KEY,
      value: { publicKey: generated.publicKey, privateKey: encryptSecret(generated.privateKey) },
    },
    update: {
      value: { publicKey: generated.publicKey, privateKey: encryptSecret(generated.privateKey) },
    },
  });
  return generated;
}

export function getVapidKeys(): Promise<VapidKeys> {
  if (!vapidPromise) {
    vapidPromise = loadOrCreateVapid().catch((error) => {
      vapidPromise = null;
      throw error;
    });
  }
  return vapidPromise;
}

export async function savePushSubscription(input: {
  userId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent?: string;
}): Promise<void> {
  const endpoint = assertSafeWebhookUrl(input.endpoint);
  await prisma.pushSubscription.upsert({
    where: { endpoint },
    create: {
      userId: input.userId,
      endpoint,
      p256dh: input.p256dh,
      auth: input.auth,
      userAgent: input.userAgent?.slice(0, 300) ?? "",
    },
    update: {
      userId: input.userId,
      p256dh: input.p256dh,
      auth: input.auth,
      userAgent: input.userAgent?.slice(0, 300) ?? "",
    },
  });
}

export async function deletePushSubscription(userId: string, endpoint: string): Promise<void> {
  await prisma.pushSubscription.deleteMany({ where: { userId, endpoint } });
}

async function dropEndpoint(endpoint: string): Promise<void> {
  await prisma.pushSubscription.deleteMany({ where: { endpoint } });
}

async function sendWebPush(keys: VapidKeys, endpoint: string, p256dh: string, auth: string, body: string): Promise<void> {
  try {
    await webpush.sendNotification(
      { endpoint, keys: { p256dh, auth } },
      body,
      {
        vapidDetails: {
          subject: vapidSubject(),
          publicKey: keys.publicKey,
          privateKey: keys.privateKey,
        },
        TTL: 86_400,
        urgency: "high",
      },
    );
  } catch (error) {
    const status = (error as { statusCode?: number }).statusCode;
    if (status === 404 || status === 410) {
      await dropEndpoint(endpoint);
      return;
    }
    throw error;
  }
}

export async function sendInboxPush(event: {
  id: string;
  hostId: string | null;
  title: string;
  message: string;
  href: string | null;
}): Promise<void> {
  const payload = buildPushPayload(event);
  broadcastPush(payload, event.hostId);

  const subscriptions = await prisma.pushSubscription.findMany({
    include: {
      user: { include: { role: true, hostAccess: true, guestAccess: true } },
    },
  });
  if (subscriptions.length === 0) return;

  const keys = await getVapidKeys();
  const body = JSON.stringify(payload);
  await Promise.all(
    subscriptions.map(async (row) => {
      if (row.user.status !== "ACTIVE") return;
      const user = toSessionUser(row.user);
      if (!userReceivesInboxPush(user, event.hostId)) return;
      try {
        await sendWebPush(keys, row.endpoint, row.p256dh, row.auth, body);
      } catch (error) {
        logger.warn(
          { err: error instanceof Error ? error.message : error, endpoint: row.endpoint },
          "Web push delivery failed",
        );
      }
    }),
  );
}

export type { PushPayload };
