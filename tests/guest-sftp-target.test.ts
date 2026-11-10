import { beforeEach, describe, expect, it, vi } from "vitest";

const settings = vi.hoisted(() => new Map<string, unknown>());
vi.mock("@/lib/db", () => ({
  prisma: {
    setting: {
      findUnique: vi.fn(async ({ where }: { where: { key: string } }) =>
        settings.has(where.key) ? { key: where.key, value: settings.get(where.key) } : null,
      ),
      create: vi.fn(async ({ data }: { data: { key: string; value: unknown } }) => {
        if (settings.has(data.key)) throw new Error("Unique constraint failed");
        settings.set(data.key, data.value);
        return data;
      }),
      deleteMany: vi.fn(async ({ where }: { where: { key: string } }) => {
        settings.delete(where.key);
        return { count: 1 };
      }),
    },
  },
}));

import {
  assertSftpTargetIsGuestAddress,
  guestReportedAddresses,
  normalizeSftpAddress,
} from "@/lib/guest-files";
import {
  forgetGuestHostKey,
  guestHostKeySettingKey,
  sshHostKeyFingerprint,
  verifyGuestHostKey,
  type GuestSshGuest,
} from "@/server/services/guest-files";

describe("guest SFTP target", () => {
  it("normalizes IPv4 and IPv6 forms", () => {
    expect(normalizeSftpAddress("10.0.0.5/24")).toBe("10.0.0.5");
    expect(normalizeSftpAddress("[2001:DB8::1]")).toBe(normalizeSftpAddress("2001:db8:0:0:0:0:0:1"));
    expect(normalizeSftpAddress("1::2::3")).toBeNull();
    expect(normalizeSftpAddress("example.com")).toBeNull();
  });

  it("collects addresses from config, QEMU agent and LXC interfaces", () => {
    const config = {
      net0: "name=eth0,bridge=vmbr0,ip=10.0.0.5/24,gw=10.0.0.1,ip6=2001:db8::5/64",
      ipconfig0: "ip=dhcp",
      description: "ip=1.2.3.4",
    };
    const agent = {
      result: [
        { name: "lo", "ip-addresses": [{ "ip-address": "127.0.0.1" }] },
        {
          name: "eth0",
          "ip-addresses": [
            { "ip-address": "192.168.1.20", "ip-address-type": "ipv4" },
            { "ip-address": "fe80::1", "ip-address-type": "ipv6" },
          ],
        },
      ],
    };
    const lxc = [{ name: "eth0", inet: "172.16.0.9/16", inet6: "fd00::9/64" }];
    expect(guestReportedAddresses({ config, agent }).sort()).toEqual(
      ["10.0.0.5", "192.168.1.20", normalizeSftpAddress("2001:db8::5")!].sort(),
    );
    expect(guestReportedAddresses({ lxcInterfaces: lxc }).sort()).toEqual(
      ["172.16.0.9", normalizeSftpAddress("fd00::9")!].sort(),
    );
  });

  it("only allows the guest's own addresses", () => {
    const addresses = ["10.0.0.5", normalizeSftpAddress("2001:db8::5")!];
    expect(assertSftpTargetIsGuestAddress(" 10.0.0.5 ", addresses)).toBe("10.0.0.5");
    expect(() => assertSftpTargetIsGuestAddress("[2001:db8:0::5]", addresses)).not.toThrow();
    expect(() => assertSftpTargetIsGuestAddress("10.0.0.6", addresses)).toThrow(/not an address/);
    expect(() => assertSftpTargetIsGuestAddress("192.168.1.1", [])).toThrow();
    expect(() => assertSftpTargetIsGuestAddress("127.0.0.1", ["127.0.0.1"])).toThrow();
  });
});

describe("guest SSH host-key pinning", () => {
  const guest = { host: { id: "h1" }, kind: "vm", vmid: 100 } as unknown as GuestSshGuest;

  beforeEach(() => settings.clear());

  it("formats OpenSSH-style fingerprints", () => {
    expect(sshHostKeyFingerprint(Buffer.from("key"))).toMatch(/^SHA256:[A-Za-z0-9+/]+$/);
  });

  it("pins the first key and rejects a different one", async () => {
    const a = sshHostKeyFingerprint(Buffer.from("key-a"));
    const b = sshHostKeyFingerprint(Buffer.from("key-b"));
    expect(await verifyGuestHostKey(guest, a)).toBe(true);
    expect(settings.get(guestHostKeySettingKey(guest))).toMatchObject({ fingerprint: a });
    expect(await verifyGuestHostKey(guest, a)).toBe(true);
    expect(await verifyGuestHostKey(guest, b)).toBe(false);
    await forgetGuestHostKey(guest);
    expect(await verifyGuestHostKey(guest, b)).toBe(true);
  });

  it("pins per guest", async () => {
    const other = { ...guest, vmid: 101 } as GuestSshGuest;
    expect(await verifyGuestHostKey(guest, "SHA256:a")).toBe(true);
    expect(await verifyGuestHostKey(other, "SHA256:b")).toBe(true);
    expect(await verifyGuestHostKey(guest, "SHA256:b")).toBe(false);
  });
});
