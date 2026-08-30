import { describe, expect, it, vi } from "vitest";
import { HostClientCache, hostClientFingerprint } from "@/server/proxmox/client-cache";
import type { ProxmoxClient } from "@/server/proxmox/client";

function host(overrides: Partial<{ id: string; url: string; encryptedSecret: string }> = {}) {
  return {
    id: "h1",
    url: "https://pve.example:8006",
    authType: "API_TOKEN" as const,
    username: "root@pam",
    tokenId: "manager",
    allowInsecureTls: true,
    encryptedSecret: "enc-1",
    ...overrides,
  };
}

function fakeClient(): ProxmoxClient {
  return { dispose: vi.fn() } as unknown as ProxmoxClient;
}

describe("HostClientCache", () => {
  it("reuses a client while the fingerprint is unchanged", () => {
    const cache = new HostClientCache();
    const first = fakeClient();
    const create = vi.fn(() => first);
    const a = cache.get(host(), create);
    const b = cache.get(host(), create);
    expect(a).toBe(first);
    expect(b).toBe(first);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("disposes and replaces the client when credentials change", () => {
    const cache = new HostClientCache();
    const first = fakeClient();
    const second = fakeClient();
    const a = cache.get(host(), () => first);
    const b = cache.get(host({ encryptedSecret: "enc-2" }), () => second);
    expect(a).toBe(first);
    expect(b).toBe(second);
    expect(first.dispose).toHaveBeenCalledTimes(1);
  });

  it("invalidates a host and closes the agent", () => {
    const cache = new HostClientCache();
    const client = fakeClient();
    cache.get(host(), () => client);
    cache.invalidate("h1");
    expect(client.dispose).toHaveBeenCalledTimes(1);
    const next = fakeClient();
    cache.get(host(), () => next);
    expect(next).not.toBe(client);
  });

  it("fingerprints connection settings, not host name", () => {
    const a = hostClientFingerprint(host());
    const b = hostClientFingerprint(host({ url: "https://other:8006" }));
    expect(a).not.toBe(b);
  });
});
