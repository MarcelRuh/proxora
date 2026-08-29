import { describe, expect, it } from "vitest";
import { rfbPasswordFromVncProxy } from "@/lib/vnc-password";

describe("rfbPasswordFromVncProxy", () => {
  it("prefers the generated 8-character password", () => {
    expect(
      rfbPasswordFromVncProxy({
        ticket: "PVEVNC:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
        password: "s3cret99",
      }),
    ).toBe("s3cret99");
  });

  it("falls back to the first 8 characters of the ticket", () => {
    expect(rfbPasswordFromVncProxy({ ticket: "PVEVNC:17351234deadbeef" })).toBe("PVEVNC:1");
  });
});
