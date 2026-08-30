export const UI_THEMES = ["standard", "operator", "atelier", "brutal", "harbor"] as const;

export type UiTheme = (typeof UI_THEMES)[number];

export const DEFAULT_UI_THEME: UiTheme = "standard";

export const UI_THEME_STORAGE_KEY = "proxora-ui-theme";

export function isUiTheme(value: string | null | undefined): value is UiTheme {
  return (UI_THEMES as readonly string[]).includes(value ?? "");
}

export function parseUiTheme(value: string | null | undefined): UiTheme {
  return isUiTheme(value) ? value : DEFAULT_UI_THEME;
}

export const UI_THEME_BOOTSTRAP = `(function(){try{var k=${JSON.stringify(UI_THEME_STORAGE_KEY)};var v=localStorage.getItem(k);var ok=${JSON.stringify(UI_THEMES)};document.documentElement.setAttribute("data-ui",ok.indexOf(v)>-1?v:"${DEFAULT_UI_THEME}");}catch(e){document.documentElement.setAttribute("data-ui","${DEFAULT_UI_THEME}");}})();`;
