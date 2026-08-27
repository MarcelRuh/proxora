import { describe, expect, it } from "vitest";
import { buildMpSpec, isBindVolume, nextIndexedKey, parseMpSpec } from "@/lib/proxmox-mp";

describe("proxmox mountpoints", () => {
  it("parses pct-style bind mounts", () => {
    expect(parseMpSpec("/host/dir,mp=/container/mount/point")).toEqual({
      volume: "/host/dir",
      path: "/container/mount/point",
      options: [],
    });
    expect(isBindVolume("/host/dir")).toBe(true);
    expect(isBindVolume("local-lvm:8")).toBe(false);
  });

  it("builds the same string pct set uses", () => {
    expect(buildMpSpec("/host/dir", "/container/mount/point")).toBe("/host/dir,mp=/container/mount/point");
    expect(buildMpSpec("/host/dir", "mnt/data", ["ro=1"])).toBe("/host/dir,mp=/mnt/data,ro=1");
  });

  it("picks the next mp index", () => {
    expect(nextIndexedKey("mp", ["mp0", "mp2"])).toBe("mp1");
  });
});
