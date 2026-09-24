import { describe, expect, it } from "vitest";
import { LXC_APT_UPGRADE_INPUT, LXC_APT_UPGRADE_LINE } from "@/lib/lxc-apt";

describe("lxc apt upgrade line", () => {
  it("runs update, upgrade, and autoremove without prompts", () => {
    expect(LXC_APT_UPGRADE_LINE).toBe("apt update && apt upgrade -y && apt autoremove -y");
    expect(LXC_APT_UPGRADE_INPUT.endsWith("\r")).toBe(true);
  });
});
