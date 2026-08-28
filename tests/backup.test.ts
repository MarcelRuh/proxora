import { describe, expect, it } from "vitest";
import {
  backupCtimeMs,
  filterBackupFiles,
  guestNeedsStopForRestore,
  jobSchedulePayload,
  normalizeBackupJob,
  parseBackupVolid,
  parseKeepLast,
  parseProxmoxTaskProgress,
  pruneKeepLast,
  waitUntilGuestStopped,
} from "@/lib/backup";

describe("backup volid parsing", () => {
  it("reads vzdump qemu archives", () => {
    const parsed = parseBackupVolid("local:backup/vzdump-qemu-100-2024_01_01-00_00_00.vma.zst");
    expect(parsed).toMatchObject({ storage: "local", kind: "vm", vmid: 100, volume: "backup/vzdump-qemu-100-2024_01_01-00_00_00.vma.zst" });
  });

  it("reads vzdump lxc archives", () => {
    const parsed = parseBackupVolid("backup:vzdump-lxc-204-2026_08_27-02_00_00.tar.zst");
    expect(parsed.kind).toBe("lxc");
    expect(parsed.vmid).toBe(204);
  });

  it("reads PBS vm and ct paths", () => {
    expect(parseBackupVolid("pbs:backup/vm/110/2024-01-01T00:00:00Z")).toMatchObject({ kind: "vm", vmid: 110, storage: "pbs" });
    expect(parseBackupVolid("pbs:backup/ct/90/2024-01-01T00:00:00Z")).toMatchObject({ kind: "lxc", vmid: 90 });
  });
});

describe("backup job helpers", () => {
  it("normalizes schedule from starttime", () => {
    const job = normalizeBackupJob({ id: "backup-1", starttime: "02:00", dow: "mon,tue", enabled: 1, storage: "local", all: 1 });
    expect(job.schedule).toBe("mon,tue 02:00");
    expect(job.enabled).toBe(true);
    expect(job.all).toBe(true);
  });

  it("builds prune and clock schedule payloads", () => {
    expect(pruneKeepLast(3)).toBe("keep-last=3");
    expect(parseKeepLast("keep-last=7,keep-daily=2")).toBe(7);
    expect(jobSchedulePayload("21:30")).toEqual({ schedule: "21:30", starttime: "21:30" });
  });

  it("treats unix seconds as milliseconds", () => {
    expect(backupCtimeMs(1_700_000_000)).toBe(1_700_000_000_000);
    expect(backupCtimeMs(1_700_000_000_000)).toBe(1_700_000_000_000);
  });
});

describe("backup file filter", () => {
  const files = [
    { volid: "local:backup/vzdump-qemu-100-a.vma.zst", storage: "local", vmid: 100, kind: "vm" as const, ctime: 1_700_000_000_000 },
    { volid: "pbs:backup/ct/204/snap", storage: "pbs", vmid: 204, kind: "lxc" as const, ctime: 1_700_050_000_000 },
    { volid: "local:backup/vzdump-qemu-110-b.vma.zst", storage: "local", vmid: 110, kind: "vm" as const, ctime: 1_600_000_000_000 },
  ];
  const names = new Map([[100, "web"], [204, "db"]]);

  it("filters by query, kind, storage and period", () => {
    expect(filterBackupFiles(files, { query: "web", kind: "all", storage: "all", period: "all" }, names)).toHaveLength(1);
    expect(filterBackupFiles(files, { query: "", kind: "lxc", storage: "all", period: "all" }).map((f) => f.vmid)).toEqual([204]);
    expect(filterBackupFiles(files, { query: "", kind: "all", storage: "pbs", period: "all" })).toHaveLength(1);
    expect(
      filterBackupFiles(files, { query: "", kind: "all", storage: "all", period: "week", now: 1_700_060_000_000 }).map((f) => f.vmid),
    ).toEqual([100, 204]);
  });
});

describe("restore stop helpers", () => {
  it("requires a stop unless the guest is already stopped", () => {
    expect(guestNeedsStopForRestore("running")).toBe(true);
    expect(guestNeedsStopForRestore("paused")).toBe(true);
    expect(guestNeedsStopForRestore("unknown")).toBe(true);
    expect(guestNeedsStopForRestore("stopped")).toBe(false);
    expect(guestNeedsStopForRestore(null)).toBe(false);
    expect(guestNeedsStopForRestore("")).toBe(false);
  });

  it("resolves once the guest reports stopped", async () => {
    let n = 0;
    await expect(
      waitUntilGuestStopped(async () => (++n < 2 ? "running" : "stopped"), {
        timeoutMs: 10_000,
        intervalMs: 1,
        sleepFn: async () => {},
      }),
    ).resolves.toBe(true);
  });

  it("times out while the guest stays running", async () => {
    let t = 0;
    await expect(
      waitUntilGuestStopped(async () => "running", {
        timeoutMs: 5,
        intervalMs: 1,
        now: () => (t += 3),
        sleepFn: async () => {},
      }),
    ).resolves.toBe(false);
  });
});

describe("proxmox restore log progress", () => {
  it("reads vzdump-style progress lines and never goes backwards", () => {
    const parsed = parseProxmoxTaskProgress([
      "restore vma archive: local:backup/vzdump-qemu-100.vma.zst",
      "progress 1% (read 1048576 bytes, duration 1 sec)",
      "progress 45% (read 47185920 bytes, duration 12 sec)",
      "progress 12% (read 12582912 bytes, duration 3 sec)",
      "restore is finished",
    ]);
    expect(parsed.percent).toBe(100);
    expect(parsed.detail).toBe("restore is finished");
  });

  it("treats LXC archive extract as early progress", () => {
    const parsed = parseProxmoxTaskProgress([
      { n: 1, t: "extracting archive '/var/lib/vz/dump/vzdump-lxc-204.tar.zst'" },
      { n: 2, t: "Total bytes: 12345" },
    ]);
    expect(parsed.percent).toBe(10);
    expect(parsed.detail).toContain("Total bytes");
  });
});
