import { describe, expect, it } from "vitest";
import {
  normalizeStorageContent,
  storageCreateAuditMeta,
  storageCreateBody,
  storageCreateSchema,
  storageScanOptions,
  storageScanSchema,
} from "@/lib/storage-create";
import { federationPermission, permissionsForShareLevel } from "@/lib/federation-access";
import { ROLE_PRESETS } from "@/lib/permissions";

describe("storage create", () => {
  it("builds an NFS body with version option and node list", () => {
    const input = storageCreateSchema.parse({
      type: "nfs",
      storage: "nas-nfs",
      content: ["backup", "iso", "backup"],
      nodes: ["pve2", "pve1", "pve1"],
      server: " 192.168.1.10 ",
      export: "/volume1/proxmox",
      nfsVersion: "4.2",
    });
    expect(storageCreateBody(input)).toEqual({
      storage: "nas-nfs",
      type: "nfs",
      content: "iso,backup",
      nodes: "pve2,pve1",
      server: "192.168.1.10",
      export: "/volume1/proxmox",
      options: "vers=4.2",
    });
  });

  it("only sends CIFS credentials when a user is given and keeps passwords out of audit", () => {
    const anon = storageCreateSchema.parse({
      type: "cifs",
      storage: "smb",
      content: ["backup"],
      server: "nas.local",
      share: "proxmox",
      password: "ignored",
      smbVersion: "default",
    });
    expect(storageCreateBody(anon)).not.toHaveProperty("password");
    expect(storageCreateBody(anon)).not.toHaveProperty("smbversion");

    const authed = storageCreateSchema.parse({
      type: "cifs",
      storage: "smb",
      content: ["backup"],
      server: "nas.local",
      share: "proxmox",
      username: "svc",
      password: "s3cret",
      smbVersion: "3.0",
    });
    expect(storageCreateBody(authed)).toMatchObject({ username: "svc", password: "s3cret", smbversion: "3.0" });
    expect(storageCreateAuditMeta(authed)).not.toHaveProperty("password");
  });

  it("builds PBS with lowercase fingerprint, drops default port and forces backup content", () => {
    const input = storageCreateSchema.parse({
      type: "pbs",
      storage: "pbs1",
      content: ["backup", "iso"],
      server: "pbs.lan",
      port: 8007,
      datastore: "store1",
      username: "backup@pbs!proxora",
      password: "token-secret",
      fingerprint: Array.from({ length: 32 }, () => "AB").join(":"),
    });
    const body = storageCreateBody(input);
    expect(body.content).toBe("backup");
    expect(body).not.toHaveProperty("port");
    expect(body.fingerprint).toBe(Array.from({ length: 32 }, () => "ab").join(":"));
  });

  it("maps local backends and boolean flags", () => {
    expect(
      storageCreateBody(
        storageCreateSchema.parse({ type: "zfspool", storage: "tank", content: ["images"], pool: "tank/vm", sparse: true }),
      ),
    ).toEqual({ storage: "tank", type: "zfspool", content: "images", pool: "tank/vm", sparse: 1 });
    expect(
      storageCreateBody(
        storageCreateSchema.parse({ type: "dir", storage: "data", content: ["iso"], path: "/mnt/data", shared: false, disable: true }),
      ),
    ).toEqual({ storage: "data", type: "dir", content: "iso", path: "/mnt/data", shared: 0, disable: 1 });
    expect(
      storageCreateBody(
        storageCreateSchema.parse({ type: "lvmthin", storage: "thin", content: ["rootdir"], vgname: "pve", thinpool: "data" }),
      ),
    ).toEqual({ storage: "thin", type: "lvmthin", content: "rootdir", vgname: "pve", thinpool: "data" });
  });

  it("rejects bad ids, servers, paths and content the backend cannot hold", () => {
    const base = { type: "dir", content: ["iso"], path: "/mnt/x" };
    for (const storage of ["1abc", "a", "bad id", "x-", "a/b"]) {
      expect(storageCreateSchema.safeParse({ ...base, storage }).success).toBe(false);
    }
    expect(storageCreateSchema.safeParse({ ...base, storage: "ok", path: "relative" }).success).toBe(false);
    expect(storageCreateSchema.safeParse({ ...base, storage: "ok", content: [] }).success).toBe(false);
    for (const server of ["https://nas", "nas;rm -rf", "nas/share", ""]) {
      expect(
        storageCreateSchema.safeParse({ type: "nfs", storage: "n", content: ["iso"], server, export: "/x" }).success,
      ).toBe(false);
    }
    expect(normalizeStorageContent("lvm", ["iso", "backup"])).toBe("");
    const lvm = storageCreateSchema.parse({ type: "lvm", storage: "lv", content: ["iso"], vgname: "vg" });
    expect(() => storageCreateBody(lvm)).toThrow();
  });
});

describe("storage scan", () => {
  it("validates scan requests", () => {
    expect(storageScanSchema.safeParse({ kind: "zfs", node: "pve" }).success).toBe(true);
    expect(storageScanSchema.safeParse({ kind: "nfs", node: "pve", server: "http://x" }).success).toBe(false);
    expect(storageScanSchema.safeParse({ kind: "pbs", node: "pve", server: "pbs", username: "a@pbs" }).success).toBe(false);
  });

  it("normalizes the different scan shapes", () => {
    expect(storageScanOptions("nfs", [{ path: "/b", options: "rw" }, { path: "/a" }, { path: "/a" }])).toEqual([
      { value: "/a", label: "/a" },
      { value: "/b", label: "/b", detail: "rw" },
    ]);
    expect(storageScanOptions("pbs", [{ store: "store1", comment: "main" }])).toEqual([
      { value: "store1", label: "store1", detail: "main" },
    ]);
    expect(storageScanOptions("lvmthin", [{ lv: "data" }, { nope: 1 }, null])).toEqual([{ value: "data", label: "data" }]);
    expect(storageScanOptions("zfs", "garbage")).toEqual([]);
  });
});

describe("storage config permission", () => {
  it("guards datacenter storage config and scans for federation peers", () => {
    expect(federationPermission("POST", "/storage")).toBe("storage.config");
    expect(federationPermission("GET", "/storage")).toBe("storage.view");
    expect(federationPermission("GET", "/nodes/pve/scan/cifs")).toBe("storage.config");
    expect(permissionsForShareLevel("control")).not.toContain("storage.config");
  });

  it("is granted to administrators but not operators or viewers", () => {
    expect(ROLE_PRESETS.administrator.permissions).toContain("storage.config");
    expect(ROLE_PRESETS.operator.permissions).not.toContain("storage.config");
    expect(ROLE_PRESETS.viewer.permissions).not.toContain("storage.config");
  });
});
