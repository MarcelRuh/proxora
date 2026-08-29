import { describe, expect, it } from "vitest";
import {
  filenameFromUrl,
  isoFamily,
  isoVersionFromFilename,
  isoVolid,
  isHttpUrl,
  mergeIsoCatalog,
} from "@/lib/iso-images";
import { configReferencesVolume, formatVolumeUsers, usersForVolids } from "@/lib/volume-usage";

describe("iso images", () => {
  it("builds iso volids and families", () => {
    expect(isoVolid("local", "debian-13.6.0-amd64-netinst.iso")).toBe("local:iso/debian-13.6.0-amd64-netinst.iso");
    expect(isoFamily("debian-13.1.0-amd64-netinst.iso")).toBe("debian-13-amd64-netinst");
    expect(isoFamily("debian-13.6.0-amd64-netinst.iso")).toBe("debian-13-amd64-netinst");
    expect(isoVersionFromFilename("debian-13.6.0-amd64-netinst.iso")).toBe("13.6.0");
    expect(isoVersionFromFilename("ubuntu-24.04.3-live-server-amd64.iso")).toBe("24.04.3");
  });

  it("parses filenames from download URLs", () => {
    expect(filenameFromUrl("https://cdimage.debian.org/debian-cd/current/amd64/iso-cd/debian-13.6.0-amd64-netinst.iso")).toBe(
      "debian-13.6.0-amd64-netinst.iso",
    );
    expect(isHttpUrl("https://example.com/a.iso")).toBe(true);
    expect(isHttpUrl("file:///etc/passwd")).toBe(false);
  });

  it("marks debian 13.1 as updatable when 13.6 is in the catalog", () => {
    const rows = mergeIsoCatalog(["local:iso/debian-13.1.0-amd64-netinst.iso"]);
    const debian = rows.find((row) => row.key === "debian-13-netinst-amd64");
    expect(debian?.updateAvailable).toBe(true);
    expect(debian?.installedVersion).toBe("13.1.0");
    expect(debian?.latestVersion).toBe("13.6.0");
    expect(debian?.installedVolids).toEqual(["local:iso/debian-13.1.0-amd64-netinst.iso"]);
  });

  it("keeps unknown installed isos in the table", () => {
    const rows = mergeIsoCatalog(["local:iso/windows-11.iso"]);
    expect(rows.some((row) => row.installedFilename === "windows-11.iso")).toBe(true);
  });
});

describe("volume usage", () => {
  it("detects ostemplate and cdrom volids", () => {
    expect(
      configReferencesVolume(
        { ostemplate: "local:vztmpl/debian-13-standard_13.1-2_amd64.tar.zst" },
        "local:vztmpl/debian-13-standard_13.1-2_amd64.tar.zst",
      ),
    ).toBe(true);
    expect(
      configReferencesVolume(
        { ide2: "local:iso/debian-13.6.0-amd64-netinst.iso,media=cdrom" },
        "local:iso/debian-13.6.0-amd64-netinst.iso",
      ),
    ).toBe(true);
    expect(configReferencesVolume({ hostname: "web" }, "local:iso/debian-13.6.0-amd64-netinst.iso")).toBe(false);
  });

  it("formats guest labels", () => {
    expect(
      formatVolumeUsers([
        { kind: "lxc", vmid: 242, name: "web", node: "pve" },
        { kind: "vm", vmid: 100, name: "win", node: "pve" },
      ]),
    ).toBe("CT 242 (web), VM 100 (win)");
    expect(
      usersForVolids(
        { "local:iso/a.iso": [{ kind: "vm", vmid: 100, name: "win", node: "pve" }] },
        ["local:iso/a.iso", "local:iso/a.iso"],
      ),
    ).toHaveLength(1);
  });
});
