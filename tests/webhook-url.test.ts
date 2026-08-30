import { describe, expect, it } from "vitest";
import { ValidationError } from "@/lib/errors";
import { assertSafeWebhookUrl, isPrivateOrLocalHostname } from "@/lib/webhook-url";

describe("webhook URL SSRF guard", () => {
  it("allows public http(s) hosts", () => {
    expect(assertSafeWebhookUrl("https://discord.com/api/webhooks/1/token")).toContain("discord.com");
    expect(assertSafeWebhookUrl("http://example.com/hook")).toContain("example.com");
  });

  it("rejects loopback, link-local, RFC1918, and local names", () => {
    expect(isPrivateOrLocalHostname("127.0.0.1")).toBe(true);
    expect(isPrivateOrLocalHostname("10.0.0.5")).toBe(true);
    expect(isPrivateOrLocalHostname("172.16.4.1")).toBe(true);
    expect(isPrivateOrLocalHostname("192.168.1.1")).toBe(true);
    expect(isPrivateOrLocalHostname("169.254.169.254")).toBe(true);
    expect(isPrivateOrLocalHostname("localhost")).toBe(true);
    expect(isPrivateOrLocalHostname("metadata.google.internal")).toBe(true);
    expect(isPrivateOrLocalHostname("8.8.8.8")).toBe(false);
    expect(() => assertSafeWebhookUrl("http://127.0.0.1/hook")).toThrow(ValidationError);
    expect(() => assertSafeWebhookUrl("https://192.168.0.10/hook")).toThrow(ValidationError);
    expect(() => assertSafeWebhookUrl("http://169.254.169.254/latest")).toThrow(ValidationError);
  });

  it("rejects credentials and non-http schemes", () => {
    expect(() => assertSafeWebhookUrl("https://user:pass@example.com/hook")).toThrow(ValidationError);
    expect(() => assertSafeWebhookUrl("ftp://example.com/hook")).toThrow(ValidationError);
    expect(() => assertSafeWebhookUrl("not a url")).toThrow(ValidationError);
  });
});
