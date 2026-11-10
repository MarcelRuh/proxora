import { describe, expect, it } from "vitest";
import { ValidationError } from "@/lib/errors";
import { assertSafeWebhookUrl, assertSafePushUrl, isPrivateOrLocalHostname } from "@/lib/webhook-url";

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
    expect(isPrivateOrLocalHostname("[::1]")).toBe(true);
    expect(isPrivateOrLocalHostname("[::ffff:127.0.0.1]")).toBe(true);
    expect(isPrivateOrLocalHostname("[::ffff:7f00:1]")).toBe(true);
    expect(isPrivateOrLocalHostname("[fe80::1]")).toBe(true);
    expect(isPrivateOrLocalHostname("[fd12:3456::1]")).toBe(true);
    expect(isPrivateOrLocalHostname("[2606:4700::1111]")).toBe(false);
    expect(isPrivateOrLocalHostname("fcbayern.de")).toBe(false);
    expect(isPrivateOrLocalHostname("fd-example.com")).toBe(false);
    expect(() => assertSafeWebhookUrl("http://[::1]:3000/api")).toThrow(ValidationError);
    expect(() => assertSafeWebhookUrl("http://[::ffff:7f00:1]/")).toThrow(ValidationError);
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

describe("push URL guard", () => {
  it("allows public and LAN UnifiedPush endpoints", () => {
    expect(assertSafePushUrl("https://ntfy.sh/upABCDEF")).toContain("ntfy.sh");
    expect(assertSafePushUrl("https://fcm.googleapis.com/fcm/send/abc")).toContain("fcm.googleapis.com");
    expect(assertSafePushUrl("http://192.168.1.10:2586/up/token")).toContain("192.168.1.10");
  });

  it("rejects loopback, metadata, and credentials", () => {
    expect(() => assertSafePushUrl("http://127.0.0.1/up")).toThrow(ValidationError);
    expect(() => assertSafePushUrl("http://127.0.0.2/up")).toThrow(ValidationError);
    expect(() => assertSafePushUrl("http://[::1]/up")).toThrow(ValidationError);
    expect(() => assertSafePushUrl("http://[::ffff:127.0.0.1]/up")).toThrow(ValidationError);
    expect(() => assertSafePushUrl("http://169.254.169.254/latest")).toThrow(ValidationError);
    expect(() => assertSafePushUrl("https://user:pass@ntfy.sh/up")).toThrow(ValidationError);
  });
});
