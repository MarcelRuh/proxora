"use client";

import { cn } from "@/lib/utils";
import { useI18n } from "@/components/i18n/locale-provider";
import { useUiTheme } from "@/components/theme/ui-theme-provider";
import { UI_THEMES, type UiTheme } from "@/lib/ui-theme";
import type { MessageKey } from "@/lib/i18n/messages";

export const THEME_COPY: Record<UiTheme, { name: MessageKey; body: MessageKey }> = {
  standard: { name: "appearance.standard", body: "appearance.standardBody" },
  operator: { name: "appearance.operator", body: "appearance.operatorBody" },
  atelier: { name: "appearance.atelier", body: "appearance.atelierBody" },
  brutal: { name: "appearance.brutal", body: "appearance.brutalBody" },
  harbor: { name: "appearance.harbor", body: "appearance.harborBody" },
};

export function ThemePreview({ theme, compact = false }: { theme: UiTheme; compact?: boolean }) {
  return (
    <div className={cn("ui-preview", compact && "ui-preview-compact")} data-ui={theme} aria-hidden>
      <div className="ui-preview-side">
        <span className="ui-preview-brand">P</span>
        <span className="ui-preview-nav ui-preview-nav-on" />
        <span className="ui-preview-nav" />
        <span className="ui-preview-nav" />
      </div>
      <div className="ui-preview-main">
        <span className="ui-preview-kicker" />
        <span className="ui-preview-heading" />
        <div className="ui-preview-card">
          <span className="ui-preview-chip" />
          <span className="ui-preview-bar">
            <span />
          </span>
        </div>
      </div>
    </div>
  );
}

export function UiThemePicker({ compact = false }: { compact?: boolean }) {
  const { t } = useI18n();
  const { uiTheme, setUiTheme } = useUiTheme();

  if (compact) {
    return (
      <div className="grid grid-cols-5 gap-1" role="listbox" aria-label={t("appearance.title")}>
        {UI_THEMES.map((theme) => {
          const active = uiTheme === theme;
          return (
            <button
              key={theme}
              type="button"
              role="option"
              aria-selected={active}
              title={t(THEME_COPY[theme].name)}
              onClick={() => setUiTheme(theme)}
              className={cn("ui-theme-chip", active && "ui-theme-chip-active")}
            >
              <ThemePreview theme={theme} compact />
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
      {UI_THEMES.map((theme) => {
        const active = uiTheme === theme;
        return (
          <button
            key={theme}
            type="button"
            onClick={() => setUiTheme(theme)}
            className={cn("ui-theme-card text-left", active && "ui-theme-card-active")}
            aria-pressed={active}
          >
            <ThemePreview theme={theme} />
            <p className="mt-2 text-sm font-medium">{t(THEME_COPY[theme].name)}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{t(THEME_COPY[theme].body)}</p>
          </button>
        );
      })}
    </div>
  );
}
