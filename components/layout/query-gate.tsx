"use client";

import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { PageSkeleton } from "@/components/layout/page-skeleton";
import { useI18n } from "@/components/i18n/locale-provider";
import { isNetworkFetchError } from "@/lib/api";

export function QueryGate({
  isLoading,
  error,
  hasData,
  onRetry,
  children,
}: {
  isLoading: boolean;
  error: unknown;
  /** When true, keep children on refetch errors and show a soft banner instead. */
  hasData?: boolean;
  onRetry?: () => void;
  children: ReactNode;
}) {
  const { t } = useI18n();
  if (isLoading) return <PageSkeleton />;
  if (error && !hasData) {
    return (
      <div className="proxora-panel p-6">
        <p className="font-medium">{t("common.pageError")}</p>
        <p className="mt-1 text-sm text-muted-foreground">
          {isNetworkFetchError(error)
            ? t("common.networkFailed")
            : error instanceof Error
              ? error.message
              : t("common.pageErrorBody")}
        </p>
        {onRetry ? (
          <Button className="mt-4" variant="outline" onClick={() => onRetry()}>
            {t("common.retry")}
          </Button>
        ) : null}
      </div>
    );
  }
  return (
    <>
      {error && hasData ? (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-[var(--ui-radius)] border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
          <p className="text-muted-foreground">
            {isNetworkFetchError(error)
              ? t("common.networkFailed")
              : error instanceof Error
                ? error.message
                : t("common.pageErrorBody")}
          </p>
          {onRetry ? (
            <Button size="sm" variant="outline" onClick={() => onRetry()}>
              {t("common.retry")}
            </Button>
          ) : null}
        </div>
      ) : null}
      {children}
    </>
  );
}
