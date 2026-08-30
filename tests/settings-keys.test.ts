import { describe, expect, it } from "vitest";
import { GUEST_IP_SETTING_KEY } from "@/lib/create-ip";
import { isPublicSettingKey, PUBLIC_SETTING_KEYS } from "@/lib/settings-keys";

describe("settings allowlist", () => {
  it("exposes only guest-ip over the public settings API", () => {
    expect(PUBLIC_SETTING_KEYS).toEqual([GUEST_IP_SETTING_KEY]);
    expect(isPublicSettingKey("guest-ip")).toBe(true);
    expect(isPublicSettingKey("disk.watch.state")).toBe(false);
    expect(isPublicSettingKey("zfs.watch.state")).toBe(false);
    expect(isPublicSettingKey("app")).toBe(false);
  });
});
