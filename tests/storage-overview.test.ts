import { describe, expect, it } from "vitest";
import { inventoryStorageForNode, inventoryToStorageOverview } from "@/lib/storage-overview";

const rows = [
  { storage: "local", type: "dir", node: "pve1", content: "iso,vztmpl,backup", disk: 10, maxdisk: 100, status: "available" },
  { storage: "local", type: "dir", node: "pve2", content: "iso,vztmpl,backup", disk: 20, maxdisk: 100, status: "available" },
  { storage: "nfs", type: "nfs", node: "pve1", content: "images", disk: 50, maxdisk: 200, shared: 1, status: "available" },
  { storage: "nfs", type: "nfs", node: "pve2", content: "images", disk: 50, maxdisk: 200, shared: 1, status: "available" },
  { storage: "offline", type: "dir", node: "pve1", content: "images", disk: 1, maxdisk: 10, status: "offline" },
];

describe("inventoryStorageForNode", () => {
  it("keeps local stores for that node and shared stores once", () => {
    const list = inventoryStorageForNode(rows, "pve1");
    expect(list.map((s) => s.storage).sort()).toEqual(["local", "nfs", "offline"]);
    expect(list.find((s) => s.storage === "local")?.used).toBe(10);
    expect(list.find((s) => s.storage === "nfs")?.avail).toBe(150);
    expect(list.find((s) => s.storage === "offline")?.active).toBe(0);
  });
});

describe("inventoryToStorageOverview", () => {
  it("groups used/free bars per node without extra Proxmox calls", () => {
    const overview = inventoryToStorageOverview(rows);
    expect(overview.map((n) => n.node).sort()).toEqual(["pve1", "pve2"]);
    const pve1 = overview.find((n) => n.node === "pve1")!;
    expect(pve1.storage.find((s) => s.storage === "local")).toMatchObject({ used: 10, avail: 90, total: 100 });
  });
});
