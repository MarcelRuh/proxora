import { describe, expect, it } from "vitest";
import {
  attachmentDisposition,
  clampSftpPort,
  GUEST_FILE_EDITOR_WARN_BYTES,
  guestFileName,
  guestPathCrumbs,
  guestPathParent,
  guestRenameDest,
  hasGuestSshAuth,
  isAllowedSftpTarget,
  isProbablyTextFile,
  looksLikeSshPrivateKey,
  parseGuestListOutput,
  resolveGuestPath,
  uploadNameConflicts,
} from "@/lib/guest-files";
import {
  createGuestTransferTicket,
  decodeGuestTransferMeta,
  encodeGuestTransferMeta,
  takeGuestTransferTicket,
} from "@/server/services/guest-file-tickets";
import { NotFoundError } from "@/lib/errors";
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

describe("guest file stream transfer", () => {
  it("keeps editor warning far above the old 8 MB JSON cap", () => {
    expect(GUEST_FILE_EDITOR_WARN_BYTES).toBeGreaterThan(8 * 1024 * 1024);
    expect(attachmentDisposition("backup.tar.gz")).toContain('filename="backup.tar.gz"');
    expect(attachmentDisposition("äöü.bin")).toContain("filename*=UTF-8''");
  });

  it("round-trips federation upload meta without exposing JSON in the URL", () => {
    const encoded = encodeGuestTransferMeta({ path: "/root/a.bin", password: "secret" });
    expect(encoded).not.toContain("secret");
    expect(decodeGuestTransferMeta(encoded)).toEqual({ path: "/root/a.bin", password: "secret" });
  });

  it("issues a one-time ticket bound to user and mode", () => {
    const issued = createGuestTransferTicket({
      userId: "u1",
      hostId: "h1",
      kind: "lxc",
      node: "pve",
      vmid: 101,
      path: "/var/lib/backup.tar",
      target: "10.0.0.8",
      username: "root",
      password: "secret",
      mode: "download",
    });
    expect(issued.path).toBe("/var/lib/backup.tar");
    expect(issued.name).toBe("backup.tar");
    expect(() => takeGuestTransferTicket(issued.ticket, "u1", "upload")).toThrow(NotFoundError);
    const upload = createGuestTransferTicket({
      userId: "u1",
      hostId: "h1",
      kind: "lxc",
      node: "pve",
      vmid: 101,
      path: "/root/a.bin",
      target: "10.0.0.8",
      username: "root",
      password: "secret",
      mode: "upload",
    });
    const row = takeGuestTransferTicket(upload.ticket, "u1", "upload");
    expect(row.mode).toBe("upload");
    expect(() => takeGuestTransferTicket(upload.ticket, "u1", "upload")).toThrow(NotFoundError);
  });

  it("rejects expired or foreign transfer tickets", () => {
    const expired = createGuestTransferTicket({
      userId: "u1",
      hostId: "h1",
      kind: "lxc",
      node: "pve",
      vmid: 101,
      path: "/root/a.bin",
      target: "10.0.0.8",
      username: "root",
      password: "secret",
      mode: "upload",
      expiresAt: Date.now() - 1,
    });
    expect(() => takeGuestTransferTicket(expired.ticket, "u1", "upload")).toThrow(NotFoundError);
    const fresh = createGuestTransferTicket({
      userId: "u1",
      hostId: "h1",
      kind: "lxc",
      node: "pve",
      vmid: 101,
      path: "/root/a.bin",
      target: "10.0.0.8",
      username: "root",
      password: "secret",
      mode: "download",
    });
    expect(() => takeGuestTransferTicket(fresh.ticket, "other", "download")).toThrow(NotFoundError);
  });

  it("accepts a private key without a password", () => {
    const pem =
      "-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAAABG5vbmU=\n-----END OPENSSH PRIVATE KEY-----";
    const issued = createGuestTransferTicket({
      userId: "u1",
      hostId: "h1",
      kind: "lxc",
      node: "pve",
      vmid: 101,
      path: "/root/a.bin",
      target: "10.0.0.8",
      username: "root",
      privateKey: pem,
      mode: "download",
    });
    const row = takeGuestTransferTicket(issued.ticket, "u1", "download");
    expect(row.password).toBe("");
    expect(row.privateKey).toContain("BEGIN OPENSSH PRIVATE KEY");
    expect(() =>
      createGuestTransferTicket({
        userId: "u1",
        hostId: "h1",
        kind: "lxc",
        node: "pve",
        vmid: 101,
        path: "/root/a.bin",
        target: "10.0.0.8",
        username: "root",
        mode: "download",
      }),
    ).toThrow(/Passwort oder Schlüssel/);
  });

  it("round-trips federation meta large enough for an SSH key", () => {
    const privateKey = `-----BEGIN OPENSSH PRIVATE KEY-----\n${"A".repeat(8_000)}\n-----END OPENSSH PRIVATE KEY-----`;
    const encoded = encodeGuestTransferMeta({ path: "/root/a.bin", privateKey });
    expect(encoded).not.toContain("PRIVATE KEY");
    expect(decodeGuestTransferMeta(encoded)).toEqual({ path: "/root/a.bin", privateKey });
  });
});

describe("guest SSH key, rename and overwrite helpers", () => {
  it("detects PEM/OpenSSH private keys", () => {
    expect(looksLikeSshPrivateKey("-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n-----END OPENSSH PRIVATE KEY-----")).toBe(
      true,
    );
    expect(looksLikeSshPrivateKey("-----BEGIN RSA PRIVATE KEY-----\nabc\n-----END RSA PRIVATE KEY-----")).toBe(true);
    expect(looksLikeSshPrivateKey("-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----")).toBe(true);
    expect(looksLikeSshPrivateKey("ssh-ed25519 AAAA")).toBe(false);
    expect(hasGuestSshAuth({ password: "x" })).toBe(true);
    expect(hasGuestSshAuth({ privateKey: "-----BEGIN OPENSSH PRIVATE KEY-----\n" })).toBe(true);
    expect(hasGuestSshAuth({ password: "  ", privateKey: "not-a-key" })).toBe(false);
  });

  it("renames only inside the same directory", () => {
    expect(guestRenameDest("/etc/hosts", "hosts.bak")).toBe("/etc/hosts.bak");
    expect(guestRenameDest("/var/www/index.html", "home.html")).toBe("/var/www/home.html");
    expect(() => guestRenameDest("/", "root")).toThrow(/Invalid path/);
    expect(() => guestRenameDest("/etc/hosts", "../passwd")).toThrow(/Invalid name/);
    expect(() => guestRenameDest("/etc/hosts", "a/b")).toThrow(/Invalid name/);
    expect(() => guestRenameDest("/etc/hosts", ".")).toThrow(/Invalid name/);
  });

  it("lists upload names that already exist", () => {
    expect(uploadNameConflicts([{ name: "a.txt" }, { name: "b.txt" }], [{ name: "a.txt" }, { name: "c.txt" }])).toEqual([
      "a.txt",
    ]);
    expect(uploadNameConflicts([], [{ name: "a.txt" }])).toEqual([]);
  });
});
