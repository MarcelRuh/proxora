"use client";

import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { PageSkeleton } from "@/components/layout/page-skeleton";
import { useI18n } from "@/components/i18n/locale-provider";

export function QueryGate({
  isLoading,
  error,
  onRetry,
  children,
}: {
  isLoading: boolean;
  error: unknown;
  onRetry?: () => void;
  children: ReactNode;
}) {
  const { t } = useI18n();
  if (isLoading) return <PageSkeleton />;
  if (error) {
    return (
      <div className="proxora-panel p-6">
        <p className="font-medium">{t("common.pageError")}</p>
        <p className="mt-1 text-sm text-muted-foreground">
          {error instanceof Error ? error.message : t("common.pageErrorBody")}
        </p>
        {onRetry ? (
          <Button className="mt-4" variant="outline" onClick={() => onRetry()}>
            {t("common.retry")}
          </Button>
        ) : null}
      </div>
    );
  }
  return children;
}
