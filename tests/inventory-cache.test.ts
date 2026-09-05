import { afterEach, describe, expect, it, vi } from "vitest";
import type { ClusterInventory, ProxmoxClient } from "@/server/proxmox/client";
import {
  clearInventoryCache,
  invalidateInventoryCache,
  loadHostInventory,
} from "@/server/services/inventory-cache";

function inventory(partial: Partial<ClusterInventory> = {}): ClusterInventory {
  return {
    nodes: [],
    vms: [],
    containers: [],
    storage: [],
    ...partial,
  };
}

function fakeClient(listInventory: () => Promise<ClusterInventory>): ProxmoxClient {
  return {
    http: { baseUrl: "https://pve.example:8006" },
    listInventory,
  } as unknown as ProxmoxClient;
}

describe("loadHostInventory", () => {
  afterEach(() => {
    clearInventoryCache();
    vi.useRealTimers();
  });

  it("reuses a fresh inventory instead of calling Proxmox again", async () => {
    const listInventory = vi.fn(async () => inventory({ storage: [{ storage: "local", type: "dir" }] }));
    const client = fakeClient(listInventory);
    const first = await loadHostInventory(client, "h1");
    const second = await loadHostInventory(client, "h1");
    expect(listInventory).toHaveBeenCalledTimes(1);
    expect(second.storage).toEqual(first.storage);
  });

  it("coalesces concurrent loads for the same host", async () => {
    let resolve!: (value: ClusterInventory) => void;
    const listInventory = vi.fn(
      () =>
        new Promise<ClusterInventory>((r) => {
          resolve = r;
        }),
    );
    const client = fakeClient(listInventory);
    const pending = Promise.all([loadHostInventory(client, "h1"), loadHostInventory(client, "h1")]);
    resolve(inventory({ nodes: [{ id: "node/pve", type: "node", node: "pve" }] }));
    const [a, b] = await pending;
    expect(listInventory).toHaveBeenCalledTimes(1);
    expect(a.nodes).toHaveLength(1);
    expect(b.nodes).toHaveLength(1);
  });

  it("refetches after invalidate or TTL expiry", async () => {
    vi.useFakeTimers();
    const listInventory = vi.fn(async () => inventory());
    const client = fakeClient(listInventory);
    await loadHostInventory(client, "h1");
    invalidateInventoryCache("h1");
    await loadHostInventory(client, "h1");
    expect(listInventory).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(10_001);
    await loadHostInventory(client, "h1");
    expect(listInventory).toHaveBeenCalledTimes(3);
  });
});
