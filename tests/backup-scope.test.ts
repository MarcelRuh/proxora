import { describe, expect, it } from "vitest";
import {
  assertBackupJobAccess,
  assertHostWideBackupAction,
  assertVmidListAccess,
  assertVolidAccess,
  canAccessVmid,
  parseVmidList,
} from "@/lib/backup-scope";
import { storageContentDeletePermission, storageContentKind } from "@/lib/storage-content";
import type { AccessScope } from "@/lib/guest-scope";

const unscoped: AccessScope = { allowedHostIds: null, allowedGuests: null };
const scoped: AccessScope = {
  allowedHostIds: ["h1"],
  allowedGuests: [
    { hostId: "h1", kind: "vm", vmid: 100 },
    { hostId: "h1", kind: "lxc", vmid: 200 },
  ],
};

describe("guest-scoped backups", () => {
  it("matches VMIDs by kind when it is known", () => {
    expect(canAccessVmid(scoped, "h1", 100)).toBe(true);
    expect(canAccessVmid(scoped, "h1", 100, "vm")).toBe(true);
    expect(canAccessVmid(scoped, "h1", 100, "lxc")).toBe(false);
    expect(canAccessVmid(scoped, "h2", 100)).toBe(false);
  });

  it("parses VMID lists strictly", () => {
    expect(parseVmidList("100, 200 300")).toEqual([100, 200, 300]);
    expect(() => parseVmidList("100,abc")).toThrow();
  });

  it("checks every VMID of a manual backup", () => {
    expect(() => assertVmidListAccess(scoped, "h1", "100,200")).not.toThrow();
    expect(() => assertVmidListAccess(scoped, "h1", "100,101")).toThrow();
    expect(() => assertVmidListAccess(scoped, "h1", "")).toThrow();
    expect(() => assertVmidListAccess(unscoped, "h1", "999")).not.toThrow();
  });

  it("derives the owner of a backup volume", () => {
    expect(() => assertVolidAccess(scoped, "h1", "local:backup/vzdump-qemu-100-2024_01_01-00_00_00.vma.zst")).not.toThrow();
    expect(() => assertVolidAccess(scoped, "h1", "local:backup/vzdump-qemu-101-2024_01_01-00_00_00.vma.zst")).toThrow();
    expect(() => assertVolidAccess(scoped, "h1", "local:backup/vzdump-lxc-100-2024_01_01-00_00_00.tar.zst")).toThrow();
    expect(() => assertVolidAccess(scoped, "h1", "pbs:backup/ct/200/2024-01-01T00:00:00Z")).not.toThrow();
    expect(() => assertVolidAccess(scoped, "h1", "local:iso/debian.iso")).toThrow();
    expect(() => assertVolidAccess(scoped, "h1", "local-lvm:vm-100-disk-0", 100)).not.toThrow();
    expect(() => assertVolidAccess(scoped, "h1", "local-lvm:vm-101-disk-0", 101)).toThrow();
    expect(() => assertVolidAccess(unscoped, "h1", "local:iso/debian.iso")).not.toThrow();
  });

  it("rejects all-guest jobs and orphan cleanup for scoped users", () => {
    expect(() => assertBackupJobAccess(scoped, "h1", { all: true, vmid: "" })).toThrow(/host-wide/);
    expect(() => assertBackupJobAccess(scoped, "h1", { all: false, vmid: "" })).toThrow(/host-wide/);
    expect(() => assertBackupJobAccess(scoped, "h1", { vmid: "100,101" })).toThrow();
    expect(() => assertBackupJobAccess(scoped, "h1", { vmid: "100" })).not.toThrow();
    expect(() => assertBackupJobAccess(unscoped, "h1", { all: true })).not.toThrow();
    expect(() => assertHostWideBackupAction(scoped)).toThrow();
    expect(() => assertHostWideBackupAction(unscoped)).not.toThrow();
  });

  it("classifies deletes by the storage's content type, not the volume name", () => {
    const disk = { volid: "backup-pool:vm-100-disk-0", content: "images", vmid: 100 };
    expect(storageContentDeletePermission(storageContentKind(disk))).toBe("storage.delete");
    const archive = { volid: "nas:dump/vzdump-qemu-100.vma.zst", content: "backup" };
    expect(storageContentDeletePermission(storageContentKind(archive))).toBe("backup.delete");
  });
});
