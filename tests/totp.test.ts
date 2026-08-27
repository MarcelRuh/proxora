import { describe, expect, it } from "vitest";
import { decodeBase32, encodeBase32, totpCode, totpOtpauthUrl, verifyTotp } from "@/lib/totp";
import { durationLabel } from "@/lib/duration";

describe("TOTP", () => {
  it("matches RFC 6238 SHA-1 at T=59", () => {
    const secret = encodeBase32(Buffer.from("12345678901234567890"));
    expect(secret).toBe("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
    expect(totpCode(secret, 59_000)).toBe("287082");
    expect(verifyTotp(secret, "287082", 0, 59_000)).toBe(true);
    expect(verifyTotp(secret, "000000", 0, 59_000)).toBe(false);
  });

  it("decodes base32 secrets with spaces", () => {
    expect(decodeBase32("GEZD GNBV").equals(decodeBase32("GEZDGNBV"))).toBe(true);
  });

  it("builds an otpauth URL", () => {
    expect(totpOtpauthUrl("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", "admin")).toContain("otpauth://totp/Proxora%3Aadmin");
  });
});

describe("durationLabel", () => {
  it("formats seconds and minutes", () => {
    expect(durationLabel(8000)).toBe("8s");
    expect(durationLabel(65000)).toBe("1m 5s");
    expect(durationLabel(120000)).toBe("2m");
  });
});
