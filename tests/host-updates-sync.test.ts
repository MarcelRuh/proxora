import { beforeEach, describe, expect, it, vi } from "vitest";

const persistAptSnapshot = vi.fn(async (host: { name: string }, count: number) => ({ notify: false, count, name: host.name }));
const host = { id: "h1", name: "pve", aptNotifiedCount: 5, aptUpdateCount: 5, proxmoxVersion: "9.0" };
const lists: Record<string, Array<{ Package: string }>> = {};
const client = {
  updates: {
    list: vi.fn(async (node: string) => lists[node] ?? []),
    refresh: vi.fn(async () => ""),
  },
  tasks: { wait: vi.fn() },
};

vi.mock("@/lib/db", () => ({ prisma: {} }));
vi.mock("@/server/services/apt-refresh", () => ({ persistAptSnapshot, notifyAptUpdates: vi.fn() }));
vi.mock("@/server/services/host-service", () => ({
  withHostClient: (_id: string, _user: unknown, fn: (c: unknown, h: unknown) => unknown) => fn(client, host),
}));
vi.mock("@/server/services/inventory-cache", () => ({
  loadHostInventory: vi.fn(async () => ({})),
  inventoryNodeNames: () => ["a", "b"],
}));

const { clearHostUpdatesListCache, listHostUpdates, refreshHostUpdates } = await import("@/server/services/update-service");
const user = {} as never;

describe("stored APT count stays in sync", () => {
  beforeEach(() => {
    persistAptSnapshot.mockClear();
    clearHostUpdatesListCache();
    host.aptUpdateCount = 5;
    lists.a = [];
    lists.b = [];
  });

  it("stores 0 when the live list shows all updates were installed", async () => {
    await listHostUpdates("h1", user);
    expect(persistAptSnapshot).toHaveBeenCalledWith(host, 0);
  });

  it("does not write when the count is unchanged", async () => {
    lists.a = [{ Package: "x" }, { Package: "y" }];
    lists.b = [{ Package: "z" }, { Package: "q" }, { Package: "r" }];
    await listHostUpdates("h1", user);
    expect(persistAptSnapshot).not.toHaveBeenCalled();
  });

  it("keeps other nodes in the total when checking one node", async () => {
    lists.b = [{ Package: "z" }, { Package: "q" }];
    await refreshHostUpdates("h1", user, "a");
    expect(persistAptSnapshot).toHaveBeenCalledWith(host, 2);
  });
});
