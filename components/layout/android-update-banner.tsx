"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { parseProxoraAndroidVersion } from "@/lib/android-apk";
import { useI18n } from "@/components/i18n/locale-provider";

type AndroidUpdate = {
  latest: string | null;
  updateAvailable: boolean;
  apkPath: string | null;
};

const SKIP_KEY = "proxora-apk-skip";

export function AndroidUpdateBanner() {
  const { t } = useI18n();
  const apkVersion = typeof navigator === "undefined" ? null : parseProxoraAndroidVersion(navigator.userAgent);
  const [skip, setSkip] = useState<string | null>(() =>
    typeof window === "undefined" ? null : sessionStorage.getItem(SKIP_KEY),
  );
  const { data } = useQuery({
    queryKey: ["android-update", apkVersion],
    queryFn: () => api<AndroidUpdate>(`/api/android/update?current=${apkVersion}`),
    enabled: Boolean(apkVersion),
    staleTime: 10 * 60_000,
  });

  if (!apkVersion || !data?.updateAvailable || !data.apkPath || !data.latest || skip === data.latest) return null;

  return (
    <div className="mb-4 flex flex-col gap-3 rounded-[var(--ui-radius)] border border-warning/40 bg-warning/10 px-4 py-3 sm:flex-row sm:items-center">
      <p className="min-w-0 flex-1 text-sm">
        <span className="font-semibold">{t("android.updateTitle")}</span>
        <span className="mt-1 block text-muted-foreground">
          {t("android.updateBody", { current: apkVersion, latest: data.latest })}
        </span>
      </p>
      <div className="flex shrink-0 flex-wrap gap-2">
        <Button size="sm" asChild>
          <a href={data.apkPath}>{t("android.updateDownload")}</a>
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            sessionStorage.setItem(SKIP_KEY, data.latest!);
            setSkip(data.latest);
          }}
        >
          {t("android.updateLater")}
        </Button>
      </div>
    </div>
  );
}
