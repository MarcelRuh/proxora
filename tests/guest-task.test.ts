import { describe, expect, it } from "vitest";
import { isUpid } from "@/lib/guest-task";

describe("isUpid", () => {
  it("accepts Proxmox UPIDs", () => {
    expect(isUpid("UPID:pve:000123:000ABC:64F00000:qmcreate:100:root@pam:")).toBe(true);
  });

  it("rejects empty and unrelated values", () => {
    expect(isUpid(null)).toBe(false);
    expect(isUpid(undefined)).toBe(false);
    expect(isUpid("")).toBe(false);
    expect(isUpid({ data: "UPID:pve:1" })).toBe(false);
    expect(isUpid("ok")).toBe(false);
  });
});
