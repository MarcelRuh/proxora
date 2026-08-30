"use client";

import { cn } from "@/lib/utils";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useI18n } from "@/components/i18n/locale-provider";
import { useUiTheme } from "@/components/theme/ui-theme-provider";
import { UI_THEMES, type UiTheme } from "@/lib/ui-theme";
import type { MessageKey } from "@/lib/i18n/messages";

const THEME_COPY: Record<UiTheme, { name: MessageKey; body: MessageKey }> = {
  standard: { name: "appearance.standard", body: "appearance.standardBody" },
  operator: { name: "appearance.operator", body: "appearance.operatorBody" },
  atelier: { name: "appearance.atelier", body: "appearance.atelierBody" },
  brutal: { name: "appearance.brutal", body: "appearance.brutalBody" },
  harbor: { name: "appearance.harbor", body: "appearance.harborBody" },
};

export function AppearanceSection() {
  const { t } = useI18n();
  const { uiTheme, setUiTheme } = useUiTheme();

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("appearance.title")}</CardTitle>
        <CardDescription>{t("appearance.body")}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {UI_THEMES.map((theme) => {
            const active = uiTheme === theme;
            return (
              <button
                key={theme}
                type="button"
                onClick={() => setUiTheme(theme)}
                className={cn(
                  "ui-theme-card text-left",
                  active && "ui-theme-card-active",
                )}
                aria-pressed={active}
              >
                <ThemePreview theme={theme} />
                <p className="mt-2 text-sm font-medium">{t(THEME_COPY[theme].name)}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{t(THEME_COPY[theme].body)}</p>
              </button>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

function ThemePreview({ theme }: { theme: UiTheme }) {
  return (
    <div className="ui-swatch" data-preview={theme} aria-hidden>
      <div className="ui-swatch-side" />
      <div className="ui-swatch-main">
        <span className="ui-swatch-title" />
        <span className="ui-swatch-row" />
        <span className="ui-swatch-row ui-swatch-row-short" />
      </div>
    </div>
  );
}
