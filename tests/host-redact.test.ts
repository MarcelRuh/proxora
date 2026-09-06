import { describe, expect, it } from "vitest";
import { redactHostForGuest } from "@/server/services/host-service";

describe("redactHostForGuest", () => {
  it("keeps federation fields and drops credentials, URL and notes", () => {
    const redacted = redactHostForGuest({
      id: "h1",
      name: "lab",
      url: "https://pve.example:8006",
      authType: "API_TOKEN",
      username: "root@pam",
      tokenId: "proxora",
      allowInsecureTls: true,
      connectionState: "ONLINE",
      lastSeenAt: new Date("2026-01-01"),
      lastError: "boom",
      proxmoxVersion: "8.4",
      clusterName: "lab",
      isClusterMember: true,
      notes: "secret rack",
      aptUpdateCount: 3,
      aptCheckedAt: new Date("2026-01-01"),
      createdAt: new Date("2026-01-01"),
      updatedAt: new Date("2026-01-01"),
      origin: "LOCAL",
      peerId: "p1",
      peerName: "Colleague",
      shareLevel: "control",
      sharePermissions: ["lxc.files"],
    });
    expect(redacted.id).toBe("h1");
    expect(redacted.origin).toBe("LOCAL");
    expect(redacted.isClusterMember).toBe(true);
    expect(redacted.shareLevel).toBe("control");
    expect(redacted.sharePermissions).toEqual(["lxc.files"]);
    expect(redacted.name).toBe("");
    expect(redacted.url).toBe("");
    expect(redacted.username).toBe("");
    expect(redacted.tokenId).toBeNull();
    expect(redacted.notes).toBeNull();
    expect(redacted.clusterName).toBeNull();
    expect(redacted.proxmoxVersion).toBeNull();
    expect(redacted.peerId).toBeNull();
    expect(redacted.peerName).toBeNull();
  });
});
