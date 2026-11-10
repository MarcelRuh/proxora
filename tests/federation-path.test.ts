import { describe, expect, it } from "vitest";
import { federationPermission, isSafeProxmoxPath } from "@/lib/federation-access";

const upid = encodeURIComponent("UPID:pve:0000ABCD:00112233:65A1B2C3:qmstart:100:root@pam:");
const volid = encodeURIComponent("local:backup/vzdump-qemu-100-2024_01_01-00_00_00.vma.zst");

describe("federation path canonicalisation", () => {
  it("accepts the paths the Proxmox API classes build", () => {
    for (const path of [
      "/version",
      "/nodes/pve/qemu/100/status/start",
      `/nodes/pve/tasks/${upid}/status`,
      `/nodes/pve/storage/local/content/${volid}`,
      "/nodes/pve/qemu/100/snapshot/before-upgrade",
    ]) {
      expect(isSafeProxmoxPath(path), path).toBe(true);
    }
  });

  it("rejects paths whose meaning could change after parsing", () => {
    for (const path of [
      "nodes/pve",
      "/nodes/pve/../../access/users",
      "/nodes/pve/./qemu",
      "/nodes/pve/qemu/100/status/start?x=1",
      "/nodes/pve/qemu/100#frag",
      "/nodes\\pve\\qemu",
      "//evil/nodes",
      "/nodes/pve/q%65mu/100/status/start",
      "/nodes/pve/storage/local/content/%2E%2E",
      "/nodes/pve/storage/local/content/a%2F..%2Fb",
      "/nodes/pve/storage/local/content/a%252Fb",
      "/nodes/pve/storage/local/content/a%5Cb",
      "/nodes/pve/storage/local/content/a%3Fb",
      "/nodes/pve/storage/local/content/%E0%A4%A",
      "/nodes/pve/qemu/100 /status",
    ]) {
      expect(isSafeProxmoxPath(path), path).toBe(false);
    }
  });

  it("denies unsafe paths before permission classification", () => {
    expect(federationPermission("GET", "/nodes/pve/../../access/users")).toBe("deny");
    expect(federationPermission("POST", "/nodes/pve/q%65mu/100/status/start")).toBe("deny");
    expect(federationPermission("GET", "/nodes/pve/qemu/100/status/current?x")).toBe("deny");
    expect(federationPermission("POST", "/nodes/pve/qemu/100/status/start")).toBe("vm.start");
    expect(federationPermission("DELETE", `/nodes/pve/storage/local/content/${volid}`)).toBe("backup.delete");
  });
});
