"use client";

import { useI18n } from "@/components/i18n/locale-provider";
import { useUiTheme } from "@/components/theme/ui-theme-provider";
import { UI_THEMES, type UiTheme } from "@/lib/ui-theme";
import type { MessageKey } from "@/lib/i18n/messages";

const THEME_LABEL: Record<UiTheme, MessageKey> = {
  standard: "appearance.standard",
  operator: "appearance.operator",
  atelier: "appearance.atelier",
  brutal: "appearance.brutal",
  harbor: "appearance.harbor",
};

export function UiThemeSelect({ className }: { className?: string }) {
  const { t } = useI18n();
  const { uiTheme, setUiTheme } = useUiTheme();
  return (
    <label className={className}>
      <span className="sr-only">{t("appearance.title")}</span>
      <select
        className="h-9 w-full rounded-[var(--ui-radius)] border border-input bg-white/[0.03] px-2 text-xs"
        value={uiTheme}
        onChange={(e) => setUiTheme(e.target.value as UiTheme)}
      >
        {UI_THEMES.map((theme) => (
          <option key={theme} value={theme}>
            {t(THEME_LABEL[theme])}
          </option>
        ))}
      </select>
    </label>
  );
}
