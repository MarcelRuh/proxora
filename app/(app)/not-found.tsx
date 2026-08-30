"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/components/i18n/locale-provider";

export default function NotFound() {
  const { t } = useI18n();
  return (
    <div className="proxora-panel mx-auto max-w-lg p-6">
      <p className="font-medium">{t("common.notFound")}</p>
      <p className="mt-1 text-sm text-muted-foreground">{t("common.notFoundBody")}</p>
      <Button className="mt-4" variant="outline" asChild>
        <Link href="/dashboard">{t("nav.dashboard")}</Link>
      </Button>
    </div>
  );
}
