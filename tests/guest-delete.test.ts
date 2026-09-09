import { describe, expect, it } from "vitest";
import type { ProxmoxClient } from "@/server/proxmox/client";
import { startGuestDelete } from "@/server/services/guest-delete";

function clientWith(statusQueue: string[], upids?: { shutdown?: string; stop?: string; delete?: string }): ProxmoxClient {
  const statuses = [...statusQueue];
  const api = {
    status: async () => ({ status: statuses.shift() ?? "stopped" }),
    shutdown: async () => upids?.shutdown ?? "UPID:pve:1:shutdown",
    stop: async () => upids?.stop ?? "UPID:pve:1:stop",
    delete: async () => upids?.delete ?? "UPID:pve:1:delete",
  };
  return { lxc: api, vms: api } as unknown as ProxmoxClient;
}

describe("startGuestDelete", () => {
  it("returns the shutdown UPID when the guest is running", async () => {
    const result = await startGuestDelete(clientWith(["running"]), {
      kind: "lxc",
      node: "pve",
      vmid: 101,
      canDeleteBackups: false,
    });
    expect(result).toEqual({ upid: "UPID:pve:1:shutdown", phase: "shutdown" });
  });

  it("returns the delete UPID when the guest is already stopped", async () => {
    const result = await startGuestDelete(clientWith(["stopped"]), {
      kind: "vm",
      node: "pve",
      vmid: 200,
      canDeleteBackups: false,
    });
    expect(result).toEqual({ upid: "UPID:pve:1:delete", phase: "delete" });
  });

  it("force-stops when delete is requested while still running", async () => {
    const result = await startGuestDelete(clientWith(["running", "running"]), {
      kind: "lxc",
      node: "pve",
      vmid: 101,
      canDeleteBackups: false,
      phase: "delete",
    });
    expect(result).toEqual({ upid: "UPID:pve:1:stop", phase: "stop" });
  });

  it("deletes after a stop phase once the guest is down", async () => {
    const result = await startGuestDelete(clientWith(["stopped", "stopped"]), {
      kind: "vm",
      node: "pve",
      vmid: 200,
      canDeleteBackups: false,
      phase: "stop",
    });
    expect(result).toEqual({ upid: "UPID:pve:1:delete", phase: "delete" });
  });

  it("rejects backup purge without permission", async () => {
    await expect(
      startGuestDelete(clientWith(["stopped"]), {
        kind: "lxc",
        node: "pve",
        vmid: 101,
        canDeleteBackups: false,
        backupVolids: ["backup:vzdump-lxc-101-2024_01_01-00_00_00.tar.zst"],
      }),
    ).rejects.toThrow();
  });
});
