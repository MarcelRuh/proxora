import type { NotificationTopic } from "@/lib/notification-topics";
import { APP_NAME, APP_VERSION, DEFAULT_GITHUB_BRANCH, DEFAULT_GITHUB_REPO } from "@/lib/version";

export type NotificationLevel = "info" | "warning" | "error" | "success";

export type DiscordNotificationEvent = {
  topic: NotificationTopic | "test";
  level: NotificationLevel;
  title: string;
  message: string;
  hostId?: string;
};

export const DISCORD_EMBED_COLORS: Record<NotificationLevel, number> = {
  success: 0x06d6a0,
  warning: 0xffd60a,
  error: 0xff5400,
  info: 0x8338ec,
};

const TOPIC_LABELS: Record<NotificationTopic | "test", string> = {
  "host.online": "Host online",
  "host.offline": "Host offline / Fehler",
  "host.updates": "Host-Updates verfügbar",
  "vm.created": "VM erstellt",
  "lxc.created": "Container erstellt",
  "vm.deleted": "VM gelöscht",
  "lxc.deleted": "Container gelöscht",
  "backup.started": "Backup gestartet",
  "backup.restored": "Backup eingespielt",
  test: "Test",
};

const LEVEL_LABELS: Record<NotificationLevel, string> = {
  success: "OK",
  warning: "Warnung",
  error: "Fehler",
  info: "Info",
};

export const TEST_NOTIFICATION_EVENT: DiscordNotificationEvent = {
  topic: "test",
  level: "success",
  title: "Proxora Test",
  message:
    "Dieser Kanal ist verbunden. Meldungen erscheinen als strukturiertes Embed — gepostet von Proxora.",
};

export function proxoraDiscordAvatarUrl(): string {
  const override = process.env.DISCORD_AVATAR_URL?.trim();
  if (override) return override;
  return `https://raw.githubusercontent.com/${DEFAULT_GITHUB_REPO}/${DEFAULT_GITHUB_BRANCH}/public/brand/proxora-icon.png`;
}

function clip(value: string, max: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, Math.max(0, max - 1))}…`;
}

export type DiscordEmbedField = {
  name: string;
  value: string;
  inline?: boolean;
};

export type DiscordWebhookPayload = {
  username: string;
  avatar_url: string;
  allowed_mentions: { parse: [] };
  embeds: Array<{
    title: string;
    description?: string;
    color: number;
    timestamp: string;
    footer: { text: string; icon_url: string };
    fields: DiscordEmbedField[];
  }>;
};

export function buildDiscordWebhookPayload(
  event: DiscordNotificationEvent,
  opts?: { now?: Date; avatarUrl?: string; version?: string },
): DiscordWebhookPayload {
  const avatarUrl = opts?.avatarUrl ?? proxoraDiscordAvatarUrl();
  const version = opts?.version ?? APP_VERSION;
  const description = clip(event.message, 4096);
  const fields: DiscordEmbedField[] = [
    { name: "Ereignis", value: TOPIC_LABELS[event.topic] ?? event.topic, inline: true },
    { name: "Stufe", value: LEVEL_LABELS[event.level] ?? event.level, inline: true },
  ];

  return {
    username: APP_NAME,
    avatar_url: avatarUrl,
    allowed_mentions: { parse: [] },
    embeds: [
      {
        title: clip(event.title || APP_NAME, 256),
        ...(description ? { description } : {}),
        color: DISCORD_EMBED_COLORS[event.level] ?? DISCORD_EMBED_COLORS.info,
        timestamp: (opts?.now ?? new Date()).toISOString(),
        footer: {
          text: `${APP_NAME} ${version}`,
          icon_url: avatarUrl,
        },
        fields,
      },
    ],
  };
}

export function discordWaitUrl(url: string): string {
  const parsed = new URL(url);
  parsed.searchParams.set("wait", "true");
  return parsed.toString();
}

export function discordErrorMessage(status: number, body: string): string {
  try {
    const parsed = JSON.parse(body) as { message?: string };
    if (parsed.message) return `Discord: ${parsed.message}`;
  } catch {
    /* ignore */
  }
  const snippet = body.replace(/\s+/g, " ").trim().slice(0, 160);
  return snippet ? `Discord ${status}: ${snippet}` : `Discord webhook failed (${status})`;
}
