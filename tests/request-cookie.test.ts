import { describe, expect, it } from "vitest";
import type { IncomingMessage } from "node:http";
import { cookieValue } from "@/server/ws/request-cookie";

const req = (cookie?: string) => ({ headers: { cookie } }) as unknown as IncomingMessage;

describe("cookieValue", () => {
  it("decodes a named cookie", () => {
    expect(cookieValue(req("a=1; pm_session=abc%3D%3D"), "pm_session")).toBe("abc==");
  });

  it("does not throw on malformed escapes", () => {
    expect(cookieValue(req("pm_session=%E0%A4%A"), "pm_session")).toBe("%E0%A4%A");
  });

  it("returns undefined when missing", () => {
    expect(cookieValue(req(), "pm_session")).toBeUndefined();
    expect(cookieValue(req("x=1"), "pm_session")).toBeUndefined();
  });
});
