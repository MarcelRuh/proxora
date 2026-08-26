import { describe, expect, it } from "vitest";
import { summarizeZfsPool } from "@/server/proxmox/zfs-health";

describe("ZFS pool health", () => {
  it("marks every disk green on a healthy mirror", () => {
    const summary = summarizeZfsPool(
      {
        name: "rpool",
        state: "ONLINE",
        children: [
          {
            name: "mirror-0",
            state: "ONLINE",
            children: [
              { name: "nvme0n1p3", state: "ONLINE", read: 0, write: 0, cksum: 0 },
              { name: "nvme1n1p3", state: "ONLINE", read: 0, write: 0, cksum: 0 },
            ],
          },
        ],
      },
      "ONLINE",
    );
    expect(summary.allHealthy).toBe(true);
    expect(summary.totalDisks).toBe(2);
    expect(summary.healthyDisks).toBe(2);
    expect(summary.devices.map((d) => d.name)).toEqual(["nvme0n1p3", "nvme1n1p3"]);
  });

  it("flags a faulted disk even if the pool still reports ONLINE", () => {
    const summary = summarizeZfsPool(
      {
        state: "ONLINE",
        children: [
          {
            name: "mirror-0",
            children: [
              { name: "sda", state: "ONLINE", read: 0, write: 0, cksum: 0 },
              { name: "sdb", state: "FAULTED", read: 12, write: 0, cksum: 1 },
            ],
          },
        ],
      },
      "ONLINE",
    );
    expect(summary.allHealthy).toBe(false);
    expect(summary.problemDisks).toBe(1);
    expect(summary.devices.find((d) => d.name === "sdb")?.healthy).toBe(false);
  });
});
