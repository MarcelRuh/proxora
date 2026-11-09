"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { parseProxoraAndroidVersion } from "@/lib/android-apk";
import { androidShellNeedsUpdate } from "@/lib/app-shell-capabilities";
import { useI18n } from "@/components/i18n/locale-provider";

type AndroidUpdate = {
  latest: string | null;
  updateAvailable: boolean;
  apkPath: string | null;
};

const SKIP_KEY = "proxora-apk-skip";
const SKIP_BRIDGE_KEY = "proxora-apk-bridge-skip";

export function AndroidUpdateBanner() {
  const { t } = useI18n();
  const apkVersion = typeof navigator === "undefined" ? null : parseProxoraAndroidVersion(navigator.userAgent);
  const [skip, setSkip] = useState<string | null>(() =>
    typeof window === "undefined" ? null : sessionStorage.getItem(SKIP_KEY),
  );
  const [skipBridge, setSkipBridge] = useState(false);
  const [needsBridge, setNeedsBridge] = useState(false);

  useEffect(() => {
    setNeedsBridge(androidShellNeedsUpdate());
    setSkipBridge(sessionStorage.getItem(SKIP_BRIDGE_KEY) === "1");
  }, []);

  const { data } = useQuery({
    queryKey: ["android-update", apkVersion],
    queryFn: () => api<AndroidUpdate>(`/api/android/update?current=${apkVersion}`),
    enabled: Boolean(apkVersion),
    staleTime: 10 * 60_000,
  });

  if (!apkVersion || !data?.apkPath) return null;

  const versionUpdate = Boolean(data.updateAvailable && data.latest && skip !== data.latest);
  const bridgeUpdate = needsBridge && !skipBridge;

  if (!versionUpdate && !bridgeUpdate) return null;

  const title = versionUpdate ? t("android.updateTitle") : t("android.bridgeTitle");
  const body = versionUpdate
    ? t("android.updateBody", { current: apkVersion, latest: data.latest! })
    : t("android.bridgeBody", { current: apkVersion });

  return (
    <div className="mb-4 flex flex-col gap-3 rounded-[var(--ui-radius)] border border-warning/40 bg-warning/10 px-4 py-3 sm:flex-row sm:items-center">
      <p className="min-w-0 flex-1 text-sm">
        <span className="font-semibold">{title}</span>
        <span className="mt-1 block text-muted-foreground">{body}</span>
      </p>
      <div className="flex shrink-0 flex-wrap gap-2">
        <Button size="sm" asChild>
          <a href={data.apkPath}>{t("android.updateDownload")}</a>
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            if (versionUpdate && data.latest) {
              sessionStorage.setItem(SKIP_KEY, data.latest);
              setSkip(data.latest);
            } else {
              sessionStorage.setItem(SKIP_BRIDGE_KEY, "1");
              setSkipBridge(true);
            }
          }}
        >
          {t("android.updateLater")}
        </Button>
      </div>
    </div>
  );
}
