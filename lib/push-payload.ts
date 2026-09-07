export const PUSH_VAPID_SETTING_KEY = "push.vapid";

export type PushPayload = {
  id: string;
  title: string;
  message: string;
  href: string | null;
};

export function buildPushPayload(input: {
  id: string;
  title: string;
  message: string;
  href?: string | null;
}): PushPayload {
  return {
    id: input.id,
    title: input.title.trim() || "Proxora",
    message: input.message,
    href: input.href?.trim() ? input.href.trim() : null,
  };
}

export function parsePushPayload(raw: unknown): PushPayload | null {
  let value: unknown = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value) as unknown;
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (row.type === "ping") return null;
  const id = typeof row.id === "string" ? row.id : "";
  const title = typeof row.title === "string" ? row.title : "";
  const message = typeof row.message === "string" ? row.message : "";
  if (!id || (!title && !message)) return null;
  const href = typeof row.href === "string" && row.href.trim() ? row.href.trim() : null;
  return { id, title: title || "Proxora", message, href };
}

export function vapidPublicKeyToBytes(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, "base64url"));
}
