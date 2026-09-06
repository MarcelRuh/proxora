import { describe, expect, it } from "vitest";
import { buildPushPayload, parsePushPayload, vapidPublicKeyToBytes } from "@/lib/push-payload";
import { userReceivesInboxPush } from "@/server/services/inbox-service";
import type { SessionUser } from "@/server/auth/session-core";

function user(permissions: string[], allowedHostIds: string[] | null = null): SessionUser {
  return {
    id: "u1",
    username: "u",
    email: "u@x",
    role: { id: "r", slug: "x", name: "x", permissions },
    allowedHostIds,
    allowedGuests: null,
    hostPermissions: null,
    guestPermissions: null,
  };
}

describe("push payload", () => {
  it("builds and parses an inbox event", () => {
    const payload = buildPushPayload({
      id: "evt1",
      title: " Host offline ",
      message: "pve-1",
      href: "/hosts/abc",
    });
    expect(payload).toEqual({
      id: "evt1",
      title: "Host offline",
      message: "pve-1",
      href: "/hosts/abc",
    });
    expect(parsePushPayload(JSON.stringify({ type: "event", ...payload }))).toEqual(payload);
  });

  it("ignores keep-alive pings", () => {
    expect(parsePushPayload({ type: "ping" })).toBeNull();
  });

  it("decodes a VAPID public key", () => {
    const bytes = vapidPublicKeyToBytes("AQID");
    expect([...bytes]).toEqual([1, 2, 3]);
  });
});

describe("inbox push recipients", () => {
  it("requires inbox-visible hosts and view permission", () => {
    const admin = user(["hosts.view"]);
    expect(userReceivesInboxPush(admin, "h1")).toBe(true);
    expect(userReceivesInboxPush(user(["notifications.view"], ["h1"]), "h1")).toBe(true);
    expect(userReceivesInboxPush(user(["notifications.view"], ["h1"]), "h2")).toBe(false);
    expect(userReceivesInboxPush(user(["vm.view"]), "h1")).toBe(false);
  });
});
