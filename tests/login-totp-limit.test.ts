import { describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({
  cookies: async () => ({ set: vi.fn() }),
  headers: async () => new Headers(),
}));
vi.mock("@/lib/db", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(async () => ({
        id: "u1",
        username: "alice",
        status: "ACTIVE",
        totpEnabled: true,
        totpSecret: "enc",
        totpRecoveryHashes: [],
      })),
      update: vi.fn(),
    },
  },
}));
vi.mock("@/lib/crypto", async (orig) => ({ ...(await orig<typeof import("@/lib/crypto")>()), decryptSecret: () => "secret" }));
vi.mock("@/lib/totp", () => ({
  createTotpTicket: vi.fn(),
  readTotpTicket: () => ({ userId: "u1", exp: Date.now() + 60_000 }),
  verifyTotp: () => false,
}));
vi.mock("@/server/services/audit-service", () => ({ writeAuditLog: vi.fn() }));

import { NextRequest } from "next/server";
import { POST } from "@/app/api/auth/login/route";

function attempt(ip: number) {
  // Different (untrusted) forwarded IPs must not reset the per-account TOTP bucket.
  return POST(
    new NextRequest("http://proxora.local/api/auth/login", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://proxora.local",
        host: "proxora.local",
        "x-forwarded-for": `198.51.100.${ip}`,
      },
      body: JSON.stringify({ ticket: "t", totp: "000000" }),
    }),
  );
}

describe("login TOTP rate limit", () => {
  it("caps 2FA guesses per account", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) statuses.push((await attempt(i)).status);
    expect(statuses.slice(0, 5)).toEqual([401, 401, 401, 401, 401]);
    expect(statuses[5]).toBe(429);
  });
});
