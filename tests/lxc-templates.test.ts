import { describe, expect, it } from "vitest";
import {
  isLxcAppliance,
  normalizeAplTemplate,
  sortAplTemplates,
  volidFilename,
  vztmplVolid,
} from "@/lib/lxc-templates";

describe("lxc templates", () => {
  it("builds and parses vztmpl volids", () => {
    expect(vztmplVolid("local", "debian-12-standard_12.7-1_amd64.tar.zst")).toBe(
      "local:vztmpl/debian-12-standard_12.7-1_amd64.tar.zst",
    );
    expect(volidFilename("local:vztmpl/debian-12-standard_12.7-1_amd64.tar.zst")).toBe(
      "debian-12-standard_12.7-1_amd64.tar.zst",
    );
  });

  it("keeps LXC appliances and drops news / non-archive types", () => {
    expect(
      isLxcAppliance({
        type: "lxc",
        template: "debian-12-standard_12.7-1_amd64.tar.zst",
        package: "debian-12-standard",
      }),
    ).toBe(true);
    expect(isLxcAppliance({ package: "pve-web-news", type: "lxc" })).toBe(false);
    expect(isLxcAppliance({ type: "iso", template: "debian.iso" })).toBe(false);
  });

  it("normalizes catalog rows from location when template is missing", () => {
    const row = normalizeAplTemplate({
      type: "lxc",
      package: "debian-12-standard",
      version: "12.7-1",
      section: "system",
      headline: "Debian 12",
      location: "http://download.proxmox.com/images/system/debian-12-standard_12.7-1_amd64.tar.zst",
    });
    expect(row?.template).toBe("debian-12-standard_12.7-1_amd64.tar.zst");
    expect(row?.headline).toBe("Debian 12");
  });

  it("sorts system images before turnkey", () => {
    const rows = [
      { template: "b", package: "b", version: "1", section: "turnkeylinux", headline: "WordPress", type: "lxc", os: "", architecture: "amd64" },
      { template: "a", package: "a", version: "1", section: "system", headline: "Debian 12", type: "lxc", os: "", architecture: "amd64" },
    ];
    rows.sort(sortAplTemplates);
    expect(rows[0]?.section).toBe("system");
  });
});
