import { describe, expect, it } from "vitest";
import {
  headlineFromPackage,
  isLxcAppliance,
  mergeTemplateCatalog,
  normalizeAplTemplate,
  parseVztmplFilename,
  storageContentVolid,
  volidFilename,
  vztmplVolid,
} from "@/lib/lxc-templates";

describe("lxc templates", () => {
  it("builds and parses vztmpl volids", () => {
    expect(vztmplVolid("local", "debian-12-standard_12.7-1_amd64.tar.zst")).toBe(
      "local:vztmpl/debian-12-standard_12.7-1_amd64.tar.zst",
    );
    expect(volidFilename("local:vztmpl/debian-13-standard_13.1-2_amd64.tar.zst")).toBe(
      "debian-13-standard_13.1-2_amd64.tar.zst",
    );
  });

  it("parses debian 13.1-2 filenames", () => {
    expect(parseVztmplFilename("debian-13-standard_13.1-2_amd64.tar.zst")).toEqual({
      package: "debian-13-standard",
      version: "13.1-2",
      architecture: "amd64",
    });
    expect(headlineFromPackage("debian-13-standard")).toBe("Debian 13 Standard");
  });

  it("reads volid from storage content rows", () => {
    expect(storageContentVolid({ volid: "local:vztmpl/debian-13-standard_13.1-2_amd64.tar.zst" })).toContain(
      "debian-13-standard_13.1-2",
    );
    expect(storageContentVolid({ storage: "local", volume: "vztmpl/debian-13-standard_13.1-2_amd64.tar.zst" })).toBe(
      "local:vztmpl/debian-13-standard_13.1-2_amd64.tar.zst",
    );
  });

  it("keeps archive appliances even when type is not lxc", () => {
    expect(
      isLxcAppliance({
        type: "system",
        template: "debian-13-standard_13.1-2_amd64.tar.zst",
        package: "debian-13-standard",
      }),
    ).toBe(true);
    expect(isLxcAppliance({ package: "pve-web-news", type: "lxc" })).toBe(false);
  });

  it("normalizes catalog rows from location when template is missing", () => {
    const row = normalizeAplTemplate({
      type: "lxc",
      package: "debian-13-standard",
      version: "13.1-2",
      section: "system",
      headline: "Debian 13",
      location: "http://download.proxmox.com/images/system/debian-13-standard_13.1-2_amd64.tar.zst",
    });
    expect(row?.template).toBe("debian-13-standard_13.1-2_amd64.tar.zst");
    expect(row?.version).toBe("13.1-2");
  });

  it("shows installed debian 13.1-2 even when the catalog only has a newer image", () => {
    const catalog = [
      {
        template: "debian-13-standard_13.6-1_amd64.tar.zst",
        package: "debian-13-standard",
        version: "13.6-1",
        section: "system",
        headline: "Debian 13",
        type: "lxc",
        os: "debian",
        architecture: "amd64",
      },
    ];
    const merged = mergeTemplateCatalog(catalog, ["local:vztmpl/debian-13-standard_13.1-2_amd64.tar.zst"]);
    expect(merged.map((row) => row.template)).toEqual([
      "debian-13-standard_13.1-2_amd64.tar.zst",
      "debian-13-standard_13.6-1_amd64.tar.zst",
    ]);
    expect(merged[0]?.installed).toBe(true);
    expect(merged[0]?.version).toBe("13.1-2");
    expect(merged[1]?.installed).toBe(false);
  });
});
