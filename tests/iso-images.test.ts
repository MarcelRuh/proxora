import { describe, expect, it } from "vitest";
import {
  filenameFromUrl,
  hasUsableVirtioIso,
  isoFamily,
  isoVersionFromFilename,
  isoVolid,
  isHttpUrl,
  isIsoContentVolid,
  isVirtioIso,
  isWindowsIso,
  mergeIsoCatalog,
  needsVirtioDownload,
  ostypeFromIso,
  parseVirtioArchiveHtml,
  pickRecommendedVirtioRelease,
  suggestVirtioIso,
  virtioCatalogItemFromRelease,
  VIRTIO_WIN_CATALOG_ITEM,
  vmCdromDisks,
  vmCreateBootOrder,
  windowsVmFirmware,
  withLiveVirtioCatalog,
} from "@/lib/iso-images";
import { cdBootNudgePlan } from "@/lib/vm-cd-boot-nudge";
import { configReferencesVolume, formatVolumeUsers, usersForVolids } from "@/lib/volume-usage";

describe("iso images", () => {
  it("builds iso volids and families", () => {
    expect(isoVolid("local", "debian-13.6.0-amd64-netinst.iso")).toBe("local:iso/debian-13.6.0-amd64-netinst.iso");
    expect(isoFamily("debian-13.1.0-amd64-netinst.iso")).toBe("debian-13-amd64-netinst");
    expect(isoFamily("debian-13.6.0-amd64-netinst.iso")).toBe("debian-13-amd64-netinst");
    expect(isoFamily("virtio-win-0.1.285.iso")).toBe("virtio-win");
    expect(isoVersionFromFilename("debian-13.6.0-amd64-netinst.iso")).toBe("13.6.0");
    expect(isoVersionFromFilename("ubuntu-24.04.3-live-server-amd64.iso")).toBe("24.04.3");
    expect(isoVersionFromFilename("virtio-win-0.1.271.iso")).toBe("0.1.271");
    expect(isIsoContentVolid("local:iso/debian-13.6.0-amd64-netinst.iso")).toBe(true);
    expect(isIsoContentVolid("local:backup/vzdump-qemu-100.vma.zst")).toBe(false);
    expect(isIsoContentVolid("local:iso/../backup/secret.iso")).toBe(false);
  });

  it("offers VirtIO 0.1.271 in the ISO catalog", () => {
    expect(VIRTIO_WIN_CATALOG_ITEM.version).toBe("0.1.271");
    const rows = mergeIsoCatalog(["local:iso/virtio-win-0.1.266.iso"]);
    const virtio = rows.find((row) => row.key === VIRTIO_WIN_CATALOG_ITEM.id);
    expect(virtio?.updateAvailable).toBe(true);
    expect(virtio?.latestFilename).toBe("virtio-win-0.1.271.iso");
    expect(hasUsableVirtioIso(["local:iso/virtio-win-0.1.285.iso"])).toBe(false);
    expect(hasUsableVirtioIso(["local:iso/virtio-win-0.1.271.iso"])).toBe(true);
  });

  it("picks the newest safe VirtIO release from archive HTML", () => {
    const html = `
      <a href="virtio-win-0.1.302-1/">virtio-win-0.1.302-1/</a>
      <a href="virtio-win-0.1.285-1/">virtio-win-0.1.285-1/</a>
      <a href="virtio-win-0.1.271-1/">virtio-win-0.1.271-1/</a>
    `;
    const releases = parseVirtioArchiveHtml(html);
    expect(releases[0]?.version).toBe("0.1.302");
    const picked = pickRecommendedVirtioRelease(releases);
    expect(picked.version).toBe("0.1.302");
    expect(picked.filename).toBe("virtio-win-0.1.302.iso");
    expect(picked.url).toContain("virtio-win-0.1.302-1/virtio-win-0.1.302.iso");
    const live = virtioCatalogItemFromRelease(picked);
    const rows = mergeIsoCatalog(["local:iso/virtio-win-0.1.271.iso"], withLiveVirtioCatalog(live));
    const virtio = rows.find((row) => row.key === VIRTIO_WIN_CATALOG_ITEM.id);
    expect(virtio?.latestVersion).toBe("0.1.302");
    expect(virtio?.updateAvailable).toBe(true);
    expect(needsVirtioDownload(["local:iso/virtio-win-0.1.271.iso"], "0.1.302")).toBe(true);
    expect(needsVirtioDownload(["local:iso/virtio-win-0.1.302.iso"], "0.1.302")).toBe(false);
  });

  it("skips known-bad VirtIO when it is the newest archive entry", () => {
    const releases = parseVirtioArchiveHtml(`
      <a href="virtio-win-0.1.285-1/">virtio-win-0.1.285-1/</a>
      <a href="virtio-win-0.1.271-2/">virtio-win-0.1.271-2/</a>
    `);
    expect(pickRecommendedVirtioRelease(releases).version).toBe("0.1.271");
    expect(pickRecommendedVirtioRelease(releases).release).toBe(2);
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

  it("detects Windows and VirtIO ISOs and maps CD-ROMs", () => {
    expect(isWindowsIso("local:iso/Win11_24H2.iso")).toBe(true);
    expect(isWindowsIso("local:iso/debian-13.6.0-amd64-netinst.iso")).toBe(false);
    expect(isVirtioIso("local:iso/virtio-win-0.1.266.iso")).toBe(true);
    expect(ostypeFromIso("local:iso/Win11_24H2.iso")).toBe("win11");
    expect(ostypeFromIso("local:iso/Win10_22H2.iso")).toBe("win10");
    expect(windowsVmFirmware("win11")).toEqual({ bios: "ovmf", machine: "q35", cpu: "host" });
    expect(windowsVmFirmware("l26")).toBeNull();
    expect(
      suggestVirtioIso(
        ["local:iso/Win11_24H2.iso", "local:iso/virtio-win-0.1.266.iso"],
        "local:iso/Win11_24H2.iso",
      ),
    ).toBe("local:iso/virtio-win-0.1.266.iso");
    expect(
      suggestVirtioIso(
        [
          "local:iso/Win11_24H2.iso",
          "local:iso/virtio-win-0.1.285.iso",
          "local:iso/virtio-win-0.1.271.iso",
        ],
        "local:iso/Win11_24H2.iso",
      ),
    ).toBe("local:iso/virtio-win-0.1.271.iso");
    expect(
      vmCdromDisks("local:iso/Win11_24H2.iso", "local:iso/virtio-win-0.1.266.iso"),
    ).toEqual({
      ide2: "local:iso/Win11_24H2.iso,media=cdrom",
      ide3: "local:iso/virtio-win-0.1.266.iso,media=cdrom",
    });
    expect(vmCreateBootOrder({ diskBus: "scsi", hasInstallIso: true })).toBe("order=ide2;scsi0");
    expect(vmCreateBootOrder({ diskBus: "virtio", hasInstallIso: false })).toBe("order=virtio0");
    expect(cdBootNudgePlan(1, 100, 10).map((s) => s.key)).toEqual(["spc", "ret", "spc"]);
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
