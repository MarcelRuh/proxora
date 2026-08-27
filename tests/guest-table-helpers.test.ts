import { describe, expect, it } from "vitest";
import { isFailedBackupTask } from "@/lib/backup-tasks";
import { DEFAULT_GUEST_SORT, nextGuestSort, sortGuests } from "@/lib/guest-sort";
import { guestHasTag, parseGuestTags, uniqueGuestTags } from "@/lib/guest-tags";

function guest(partial: Partial<{ vmid: number; name: string; cpu: number; cpus: number; mem: number; maxmem: number; disk: number; maxdisk: number; uptime: number; node: string; status: string }>) {
  return {
    vmid: 100,
    name: "web",
    node: "pve",
    status: "running",
    cpu: 0.1,
    cpus: 2,
    mem: 1,
    maxmem: 2,
    disk: 1,
    maxdisk: 2,
    uptime: 10,
    ...partial,
  };
}

describe("parseGuestTags", () => {
  it("splits Proxmox semicolon tags", () => {
    expect(parseGuestTags("prod;web; linux")).toEqual(["prod", "web", "linux"]);
    expect(parseGuestTags("")).toEqual([]);
    expect(guestHasTag("prod;web", "Web")).toBe(true);
    expect(uniqueGuestTags([{ tags: "b;a" }, { tags: "a" }])).toEqual(["a", "b"]);
  });
});

describe("guest sort", () => {
  it("sorts by RAM usage descending first", () => {
    const next = nextGuestSort(DEFAULT_GUEST_SORT, "ram");
    expect(next).toEqual({ key: "ram", dir: "desc" });
    const rows = sortGuests(
      [guest({ vmid: 1, mem: 1, maxmem: 4, name: "low" }), guest({ vmid: 2, mem: 3, maxmem: 4, name: "high" })],
      next,
    );
    expect(rows.map((g) => g.name)).toEqual(["high", "low"]);
  });

  it("toggles direction on the same column", () => {
    expect(nextGuestSort({ key: "name", dir: "asc" }, "name")).toEqual({ key: "name", dir: "desc" });
  });
});

describe("failed backup tasks", () => {
  it("detects stopped vzdump jobs that are not OK", () => {
    expect(isFailedBackupTask({ type: "vzdump", status: "stopped", exitstatus: "command failed" })).toBe(true);
    expect(isFailedBackupTask({ type: "vzdump", status: "stopped", exitstatus: "OK" })).toBe(false);
    expect(isFailedBackupTask({ type: "qmstart", status: "stopped", exitstatus: "command failed" })).toBe(false);
    expect(isFailedBackupTask({ type: "vzdump", status: "running" })).toBe(false);
  });
});
