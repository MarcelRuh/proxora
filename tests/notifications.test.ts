import { describe, expect, it } from "vitest";
import {
  buildDiscordWebhookPayload,
  DISCORD_EMBED_COLORS,
  discordErrorMessage,
  discordWaitUrl,
  TEST_NOTIFICATION_EVENT,
} from "@/lib/discord-embed";
import { channelAllowsTopic, parseNotificationEvents } from "@/lib/notification-topics";
import { sendNotificationTest } from "@/server/notifications/send-test";
import { pickGuestName } from "@/server/notifications/guest-name";

describe("notification topic filters", () => {
  it("treats a missing list as all events", () => {
    expect(channelAllowsTopic(null, "vm.created")).toBe(true);
    expect(channelAllowsTopic(undefined, "host.offline")).toBe(true);
  });

  it("honours an explicit selection", () => {
    expect(channelAllowsTopic(["host.updates", "vm.created"], "vm.created")).toBe(true);
    expect(channelAllowsTopic(["host.updates"], "lxc.created")).toBe(false);
    expect(channelAllowsTopic([], "host.online")).toBe(false);
  });

  it("drops unknown event ids", () => {
    expect(parseNotificationEvents(["vm.created", "nope", 1])).toEqual(["vm.created"]);
  });
});

describe("discord embeds", () => {
  it("posts as Proxora with a structured embed and no plain content", () => {
    const payload = buildDiscordWebhookPayload(
      {
        topic: "vm.created",
        level: "success",
        title: "VM erstellt",
        message: "VM 100 (web)",
        name: "web",
        id: "100",
        host: "pve-lab",
        node: "pve",
      },
      {
        now: new Date("2026-08-27T13:00:00.000Z"),
        avatarUrl: "https://example.com/icon.png",
        version: "1.0.33",
      },
    );

    expect(payload.username).toBe("Proxora");
    expect(payload.avatar_url).toBe("https://example.com/icon.png");
    expect(payload).not.toHaveProperty("content");
    expect(payload.embeds).toHaveLength(1);
    expect(payload.embeds[0]).toMatchObject({
      title: "VM erstellt",
      description: "VM 100 (web)",
      color: DISCORD_EMBED_COLORS.success,
      timestamp: "2026-08-27T13:00:00.000Z",
      footer: { text: "Proxora 1.0.33", icon_url: "https://example.com/icon.png" },
    });
    expect(payload.embeds[0].fields).toEqual([
      { name: "Name", value: "web", inline: true },
      { name: "ID", value: "100", inline: true },
      { name: "Host", value: "pve-lab", inline: true },
      { name: "Node", value: "pve", inline: true },
      { name: "Ereignis", value: "VM erstellt", inline: true },
      { name: "Stufe", value: "OK", inline: true },
    ]);
  });

  it("uses warning and error colors", () => {
    expect(buildDiscordWebhookPayload({ ...TEST_NOTIFICATION_EVENT, level: "warning", topic: "host.updates" }).embeds[0].color).toBe(
      DISCORD_EMBED_COLORS.warning,
    );
    expect(buildDiscordWebhookPayload({ ...TEST_NOTIFICATION_EVENT, level: "error", topic: "host.offline" }).embeds[0].color).toBe(
      DISCORD_EMBED_COLORS.error,
    );
  });

  it("appends wait=true without dropping the token", () => {
    expect(discordWaitUrl("https://discord.com/api/webhooks/1/abc")).toBe(
      "https://discord.com/api/webhooks/1/abc?wait=true",
    );
  });

  it("parses Discord error JSON", () => {
    expect(discordErrorMessage(401, '{"message":"Invalid Webhook Token"}')).toBe("Discord: Invalid Webhook Token");
    expect(discordErrorMessage(500, "")).toBe("Discord webhook failed (500)");
  });

  it("fills missing identity fields with a dash", () => {
    const fields = buildDiscordWebhookPayload({
      topic: "host.offline",
      level: "error",
      title: "Host offline",
      message: "gone",
    }).embeds[0].fields;
    expect(fields.slice(0, 4)).toEqual([
      { name: "Name", value: "—", inline: true },
      { name: "ID", value: "—", inline: true },
      { name: "Host", value: "—", inline: true },
      { name: "Node", value: "—", inline: true },
    ]);
  });
});

describe("guest name lookup", () => {
  it("reads name or hostname from status payloads", () => {
    expect(pickGuestName({ name: "web-01" })).toBe("web-01");
    expect(pickGuestName({ hostname: "ct-mail" })).toBe("ct-mail");
    expect(pickGuestName({})).toBeUndefined();
  });
});

describe("notification test send", () => {
  it("rejects unknown types and missing URLs without calling a webhook", async () => {
    await expect(sendNotificationTest("email", { url: "https://example.com/hook" })).rejects.toThrow(
      "Unknown channel type",
    );
    await expect(sendNotificationTest("discord", { url: "   " })).rejects.toThrow("Webhook URL is missing");
  });
});
