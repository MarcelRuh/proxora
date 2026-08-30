import { describe, expect, it } from "vitest";
import { safeNextPath } from "@/lib/safe-next";

describe("safeNextPath", () => {
  it("keeps in-app paths", () => {
    expect(safeNextPath("/vms/abc/pve/100")).toBe("/vms/abc/pve/100");
    expect(safeNextPath("/dashboard")).toBe("/dashboard");
  });

  it("rejects open redirects", () => {
    expect(safeNextPath("https://evil.example/phish")).toBe("/dashboard");
    expect(safeNextPath("//evil.example")).toBe("/dashboard");
    expect(safeNextPath("/\\evil.example")).toBe("/dashboard");
    expect(safeNextPath("https://example.com")).toBe("/dashboard");
    expect(safeNextPath(null)).toBe("/dashboard");
  });
});
