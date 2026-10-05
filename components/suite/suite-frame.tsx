"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { SuiteEmbeds } from "@/lib/suite-embeds";
import { useI18n } from "@/components/i18n/locale-provider";

export function SuiteFrame({ id }: { id: string }) {
  const { t } = useI18n();
  const { data, isLoading } = useQuery({
    queryKey: ["embeds"],
    queryFn: () => api<SuiteEmbeds>("/api/embeds"),
  });
  const app = data?.apps.find((item) => item.id === id) ?? null;

  if (isLoading) return <p className="p-4 text-sm text-muted-foreground">{t("common.loading")}</p>;

  if (!app) {
    return (
      <div className="p-4 text-sm">
        <p className="text-muted-foreground">{t("suite.missing", { name: id })}</p>
        <Link href="/settings#suite" className="mt-2 inline-block text-primary underline-offset-4 hover:underline">
          {t("nav.settings")}
        </Link>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100dvh-3.25rem)] min-h-0 flex-col lg:h-dvh">
      <div className="flex items-center justify-between gap-3 border-b border-border px-3 py-2">
        <p className="text-sm font-medium">{app.name}</p>
        <a href={app.url} target="_blank" rel="noreferrer" className="text-sm text-primary underline-offset-4 hover:underline">
          {t("suite.open")}
        </a>
      </div>
      <iframe title={app.name} src={app.url} className="min-h-0 w-full flex-1 border-0 bg-background" />
    </div>
  );
}
