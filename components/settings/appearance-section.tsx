"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useI18n } from "@/components/i18n/locale-provider";
import { UiThemePicker } from "@/components/theme/ui-theme-picker";

export function AppearanceSection() {
  const { t } = useI18n();

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("appearance.title")}</CardTitle>
        <CardDescription>{t("appearance.body")}</CardDescription>
      </CardHeader>
      <CardContent>
        <UiThemePicker />
      </CardContent>
    </Card>
  );
}
