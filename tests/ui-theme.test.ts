import { describe, expect, it } from "vitest";
import { DEFAULT_UI_THEME, isUiTheme, parseUiTheme, UI_THEME_BOOTSTRAP, UI_THEMES } from "@/lib/ui-theme";

describe("ui themes", () => {
  it("keeps standard as the default and parses known ids", () => {
    expect(DEFAULT_UI_THEME).toBe("standard");
    expect(UI_THEMES).toEqual(["standard", "operator", "atelier", "brutal", "harbor"]);
    expect(isUiTheme("atelier")).toBe(true);
    expect(isUiTheme("neon")).toBe(false);
    expect(parseUiTheme("operator")).toBe("operator");
    expect(parseUiTheme("nope")).toBe("standard");
    expect(parseUiTheme(null)).toBe("standard");
  });

  it("bootstraps only known theme ids onto html", () => {
    expect(UI_THEME_BOOTSTRAP).toContain("proxora-ui-theme");
    expect(UI_THEME_BOOTSTRAP).toContain("data-ui");
    for (const theme of UI_THEMES) expect(UI_THEME_BOOTSTRAP).toContain(theme);
  });
});
