import { describe, expect, it } from "vitest";
import { hostAllowsCreate } from "@/components/guests/host-select";
import {
  createOptionsPath,
  mergeCreateOptions,
  nextAutoVmid,
  sameHostPlaceholder,
  type CreateOptions,
} from "@/lib/guest-create-options";
import type { PublicHost } from "@/lib/types";

function peer(permissions: string[] | null): PublicHost {
  return {
    id: "h1",
    name: "shared",
    url: "https://pve.example",
    authType: "API_TOKEN",
    username: "root@pam",
    tokenId: null,
    allowInsecureTls: false,
    connectionState: "ONLINE",
    lastSeenAt: null,
    lastError: null,
    proxmoxVersion: null,
    clusterName: null,
    isClusterMember: false,
    notes: null,
    origin: "PEER",
    shareLevel: "create",
    sharePermissions: permissions,
  };
}

const shell: CreateOptions = {
  nodes: [{ node: "pve" }],
  nextid: 101,
  storage: [],
  isos: [{ volid: "local:iso/a.iso" }],
  templates: [{ volid: "local:vztmpl/old.tar.zst" }],
  bridges: [{ iface: "vmbr0" }],
  usedIps: [],
  usedVmids: [100],
};

describe("create options merge", () => {
  it("drops placeholder data from another host", () => {
    expect(sameHostPlaceholder("b", shell, { queryKey: ["options", "a", ""] })).toBeUndefined();
    expect(sameHostPlaceholder("a", shell, { queryKey: ["options", "a", "pve"] })).toBe(shell);
  });

  it("prefers IP-aware nextid and media catalogs", () => {
    const merged = mergeCreateOptions(
      shell,
      { isos: [{ volid: "local:iso/b.iso" }], templates: [{ volid: "local:vztmpl/new.tar.zst" }] },
      { usedIps: ["192.168.178.101"], usedVmids: [100, 101], nextid: 102 },
    );
    expect(merged?.nextid).toBe(102);
    expect(merged?.usedIps).toEqual(["192.168.178.101"]);
    expect(merged?.usedVmids).toEqual([100, 101]);
    expect(merged?.templates[0]?.volid).toBe("local:vztmpl/new.tar.zst");
  });

  it("keeps the auto VMID in sync, but not a manual edit", () => {
    expect(nextAutoVmid(0, 101, 0)).toBe(101);
    expect(nextAutoVmid(101, 102, 101)).toBe(102);
    expect(nextAutoVmid(200, 102, 101)).toBe(200);
  });

  it("puts node and media on the options path", () => {
    expect(createOptionsPath("h1", { node: "pve2", media: true })).toBe(
      "/api/hosts/h1/options?node=pve2&media=1",
    );
  });
});

describe("hostAllowsCreate", () => {
  it("hides a peer that can only create LXC from VM create", () => {
    const lxcOnly = peer(["hosts.view", "lxc.create"]);
    expect(hostAllowsCreate(lxcOnly, "lxc")).toBe(true);
    expect(hostAllowsCreate(lxcOnly, "vm")).toBe(false);
    expect(hostAllowsCreate(peer(["hosts.view", "vm.create"]), "lxc")).toBe(false);
  });

  it("always allows local hosts", () => {
    expect(hostAllowsCreate({ ...peer(null), origin: "LOCAL" }, "vm")).toBe(true);
  });
});
