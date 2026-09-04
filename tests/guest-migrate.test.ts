import { describe, expect, it } from "vitest";
import { guestIsRunning, lxcMigrateParams, migrateTargetNodes, qemuMigrateParams } from "@/lib/guest-migrate";

describe("migrateTargetNodes", () => {
  it("skips the current node and offline nodes", () => {
    expect(
      migrateTargetNodes(
        [
          { node: "pve1", online: "online" },
          { node: "pve2", online: "offline" },
          { node: "pve3", online: "online" },
        ],
        "pve1",
      ),
    ).toEqual(["pve3"]);
  });

  it("returns nothing on a single-node host", () => {
    expect(migrateTargetNodes([{ node: "pve", online: "online" }], "pve")).toEqual([]);
  });
});

describe("migrate params", () => {
  it("moves local disks and uses online only when running", () => {
    expect(qemuMigrateParams("pve2", true)).toEqual({ target: "pve2", online: 1, "with-local-disks": 1 });
    expect(qemuMigrateParams("pve2", false)).toEqual({ target: "pve2", online: 0, "with-local-disks": 1 });
  });

  it("restarts a running container on the target", () => {
    expect(lxcMigrateParams("pve2", true)).toEqual({ target: "pve2", restart: 1 });
    expect(lxcMigrateParams("pve2", false)).toEqual({ target: "pve2", restart: 0 });
  });

  it("treats paused as running for live migrate", () => {
    expect(guestIsRunning("paused")).toBe(true);
    expect(guestIsRunning("stopped")).toBe(false);
  });
});
