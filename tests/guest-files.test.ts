import { describe, expect, it } from "vitest";
import {
  clampSftpPort,
  guestFileName,
  guestPathCrumbs,
  guestPathParent,
  isAllowedSftpTarget,
  isProbablyTextFile,
  parseGuestListOutput,
  resolveGuestPath,
} from "@/lib/guest-files";
import { encodeProxmoxFormBody } from "@/server/proxmox/http";
import { shareHasPermission } from "@/lib/federation-access";
import { hasPermission, ROLE_PRESETS } from "@/lib/permissions";

describe("guest file paths", () => {
  it("normalizes and blocks traversal past root", () => {
    expect(resolveGuestPath("/var/www")).toBe("/var/www");
    expect(resolveGuestPath("/var/www/", "../www/html")).toBe("/var/www/html");
    expect(resolveGuestPath("/etc", "./hosts")).toBe("/etc/hosts");
    expect(() => resolveGuestPath("/etc", "../../passwd")).toThrow(/Invalid path/);
    expect(resolveGuestPath("/", "foo")).toBe("/foo");
    expect(guestPathParent("/etc/hosts")).toBe("/etc");
    expect(guestPathParent("/etc")).toBe("/");
    expect(guestPathParent("/")).toBeNull();
    expect(guestFileName("/etc/hosts")).toBe("hosts");
  });

  it("rejects loopback and metadata SSH targets", () => {
    expect(isAllowedSftpTarget("192.168.178.50")).toBe("192.168.178.50");
    expect(isAllowedSftpTarget("10.0.0.8")).toBe("10.0.0.8");
    expect(() => isAllowedSftpTarget("127.0.0.1")).toThrow(/Invalid SSH host/);
    expect(() => isAllowedSftpTarget("169.254.169.254")).toThrow(/Invalid SSH host/);
    expect(() => isAllowedSftpTarget("debian.local")).toThrow(/Invalid SSH host/);
    expect(() => isAllowedSftpTarget("::1")).toThrow(/Invalid SSH host/);
    expect(clampSftpPort(22)).toBe(22);
    expect(clampSftpPort("2222")).toBe(2222);
    expect(() => clampSftpPort(0)).toThrow(/Invalid SSH port/);
  });

  it("detects text files for the editor", () => {
    expect(isProbablyTextFile("nginx.conf")).toBe(true);
    expect(isProbablyTextFile("app.py", new TextEncoder().encode("print(1)\n"))).toBe(true);
    expect(isProbablyTextFile("blob.bin", new Uint8Array([0, 1, 2, 3, 255]))).toBe(false);
  });
});

describe("guest file permissions", () => {
  it("keeps files off viewers and on operators", () => {
    expect(hasPermission(ROLE_PRESETS.viewer.permissions, "lxc.files")).toBe(false);
    expect(hasPermission(ROLE_PRESETS.viewer.permissions, "vm.files")).toBe(false);
    expect(hasPermission(ROLE_PRESETS.operator.permissions, "lxc.files")).toBe(true);
    expect(hasPermission(ROLE_PRESETS.operator.permissions, "vm.files")).toBe(true);
  });

  it("does not include SFTP in view-level host shares", () => {
    expect(shareHasPermission("view", null, "lxc.files")).toBe(false);
    expect(shareHasPermission("control", null, "lxc.files")).toBe(true);
    expect(shareHasPermission("control", null, "vm.files")).toBe(true);
  });
});

describe("guest file explorer helpers", () => {
  it("builds breadcrumbs", () => {
    expect(guestPathCrumbs("/")).toEqual([{ name: "/", path: "/" }]);
    expect(guestPathCrumbs("/etc/nginx")).toEqual([
      { name: "/", path: "/" },
      { name: "etc", path: "/etc" },
      { name: "nginx", path: "/etc/nginx" },
    ]);
  });

  it("parses find -printf and ls -1Ap listings", () => {
    const found = parseGuestListOutput("d\t4096\t1710000000.5\tetc\nf\t12\t1710000001\thosts\n", "/");
    expect(found.map((e) => e.name)).toEqual(["etc", "hosts"]);
    expect(found[0]?.type).toBe("dir");
    expect(found[1]?.type).toBe("file");
    expect(found[1]?.size).toBe(12);
    const listed = parseGuestListOutput("bin/\nhosts\nscript.sh*\n", "/");
    expect(listed.map((e) => [e.name, e.type])).toEqual([
      ["bin", "dir"],
      ["hosts", "file"],
      ["script.sh", "file"],
    ]);
  });

  it("encodes Proxmox agent command arrays as repeated form fields", () => {
    expect(encodeProxmoxFormBody({ command: ["ls", "-1Ap", "--", "/etc"] })).toBe(
      "command=ls&command=-1Ap&command=--&command=%2Fetc",
    );
  });
});
