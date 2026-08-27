import { describe, expect, it } from "vitest";
import { interpolate, messages, translate } from "@/lib/i18n/messages";

describe("i18n", () => {
  it("interpolates placeholders", () => {
    expect(interpolate("Clone {kind} {id}", { kind: "VM", id: 100 })).toBe("Clone VM 100");
  });

  it("falls back to German", () => {
    expect(translate("de", "nav.settings")).toBe("Einstellungen");
    expect(translate("en", "nav.settings")).toBe("Settings");
  });

  it("keeps German and English keys in sync", () => {
    expect(Object.keys(messages.en).sort()).toEqual(Object.keys(messages.de).sort());
  });
});
