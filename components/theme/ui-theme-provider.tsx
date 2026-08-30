"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { DEFAULT_UI_THEME, parseUiTheme, UI_THEME_STORAGE_KEY, type UiTheme } from "@/lib/ui-theme";

type UiThemeValue = {
  uiTheme: UiTheme;
  setUiTheme: (theme: UiTheme) => void;
};

const UiThemeContext = createContext<UiThemeValue | null>(null);

function applyTheme(theme: UiTheme) {
  document.documentElement.setAttribute("data-ui", theme);
}

export function UiThemeProvider({ children }: { children: ReactNode }) {
  const [uiTheme, setUiThemeState] = useState<UiTheme>(DEFAULT_UI_THEME);

  useEffect(() => {
    const saved = parseUiTheme(window.localStorage.getItem(UI_THEME_STORAGE_KEY));
    setUiThemeState(saved);
    applyTheme(saved);
  }, []);

  const setUiTheme = useCallback((next: UiTheme) => {
    setUiThemeState(next);
    window.localStorage.setItem(UI_THEME_STORAGE_KEY, next);
    applyTheme(next);
  }, []);

  const value = useMemo(() => ({ uiTheme, setUiTheme }), [uiTheme, setUiTheme]);
  return <UiThemeContext.Provider value={value}>{children}</UiThemeContext.Provider>;
}

export function useUiTheme() {
  const ctx = useContext(UiThemeContext);
  if (!ctx) throw new Error("useUiTheme must be used within UiThemeProvider");
  return ctx;
}
