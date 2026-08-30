"use client";

import { Button } from "@/components/ui/button";
import { useI18n } from "@/components/i18n/locale-provider";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="proxora-panel mx-auto max-w-lg p-6">
      <p className="font-medium">{t("common.pageError")}</p>
      <p className="mt-1 text-sm text-muted-foreground">{t("common.pageErrorBody")}</p>
      {error.digest ? <p className="mt-2 font-mono text-xs text-muted-foreground">{error.digest}</p> : null}
      <Button className="mt-4" variant="outline" onClick={() => reset()}>
        {t("common.retry")}
      </Button>
    </div>
  );
}
