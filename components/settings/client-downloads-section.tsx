"use client";

import { useSyncExternalStore, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/api";
import { copyText } from "@/lib/clipboard";
import { cn } from "@/lib/utils";
import { useI18n } from "@/components/i18n/locale-provider";
import type { DesktopPlatform } from "@/lib/desktop-clients";

type ReleaseFile = { name: string; size: number };

type ClientsResponse = {
  version: string;
  tag: string;
  releaseUrl: string | null;
  platforms: Record<DesktopPlatform, ReleaseFile | null>;
  android: boolean;
  /** GitHub did not answer the file list; the tiles fill in on a later poll. */
  assetsUnavailable?: boolean;
};

type DeviceOs = "windows" | "macos" | "linux" | "android";

const TILE_ORDER: DeviceOs[] = ["windows", "macos", "linux", "android"];

// Browsers number repeated downloads ("install-proxora-macos (1).sh"), so run the newest one.
const MAC_RUN = 'bash "$(ls -t ~/Downloads/install-proxora-macos*.sh | head -n 1)"';
const MAC_UNQUARANTINE = "xattr -dr com.apple.quarantine /Applications/Proxora.app";
const LINUX_CHMOD = "chmod +x ~/Downloads/Proxora_*_amd64.AppImage";

const LINK = "text-xs text-primary underline-offset-4 hover:underline";

function fileLabel(file: ReleaseFile): string {
  return file.size > 0 ? `${file.name} · ${(file.size / 1024 / 1024).toFixed(1)} MB` : file.name;
}

function detectOs(): DeviceOs | null {
  const ua = navigator.userAgent;
  if (/Android/i.test(ua)) return "android";
  if (/iPhone|iPad|iPod/i.test(ua)) return null;
  if (/Windows/i.test(ua)) return "windows";
  // iPadOS asks for desktop pages with a Mac user agent; only real Macs have no touch screen.
  if (/Macintosh/i.test(ua)) return navigator.maxTouchPoints > 1 ? null : "macos";
  if (/Linux|X11/i.test(ua)) return "linux";
  return null;
}

const noSubscribe = () => () => {};

function CopyLine({ text }: { text: string }) {
  const { t } = useI18n();
  return (
    <div className="mt-1 flex items-center gap-2">
      <code className="min-w-0 flex-1 select-all overflow-x-auto whitespace-nowrap rounded-md bg-muted px-2 py-1.5 font-mono text-xs">
        {text}
      </code>
      <Button
        size="sm"
        variant="ghost"
        onClick={() => {
          void copyText(text).then((ok) =>
            ok ? toast.success(t("clients.copied")) : toast.error(t("clients.copyFailed")),
          );
        }}
      >
        {t("clients.copy")}
      </Button>
    </div>
  );
}

function Tile({ title, current, children }: { title: string; current: boolean; children: ReactNode }) {
  const { t } = useI18n();
  return (
    <section
      className={cn(
        "flex flex-col gap-3 rounded-[var(--ui-radius)] border p-4",
        current ? "border-primary/60" : "border-border/60",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{title}</h3>
        {current ? <Badge variant="outline">{t("clients.thisDevice")}</Badge> : null}
      </div>
      {children}
    </section>
  );
}

function DownloadButton({ href, filename, children }: { href: string; filename?: string; children: ReactNode }) {
  return (
    <Button size="sm" asChild className="self-start">
      <a href={href} download={filename ?? true}>
        {children}
      </a>
    </Button>
  );
}

function Hint({ children }: { children: ReactNode }) {
  return <p className="text-xs text-muted-foreground">{children}</p>;
}

export function ClientDownloadsSection() {
  const { t } = useI18n();
  const os = useSyncExternalStore(noSubscribe, detectOs, () => null);
  const origin = useSyncExternalStore(noSubscribe, () => window.location.origin, () => "");
  const { data, isLoading, isError, isFetching, refetch } = useQuery({
    queryKey: ["desktop-clients"],
    queryFn: () => api<ClientsResponse>("/api/desktop/clients"),
    staleTime: 5 * 60_000,
    // GitHub did not answer the file list: keep asking until the tiles can be filled.
    refetchInterval: (query) => (query.state.data?.assetsUnavailable ? 30_000 : false),
  });
  const p = data?.platforms;
  const missing = <Hint>{t(data?.assetsUnavailable ? "clients.unavailable" : "clients.notYet")}</Hint>;
  // The script presets the server the user is on right now; the route only accepts this instance's own origin.
  const macScriptHref = origin ? `/api/desktop/install-macos?server=${encodeURIComponent(origin)}` : "/api/desktop/install-macos";
  const order = os ? [os, ...TILE_ORDER.filter((id) => id !== os)] : TILE_ORDER;

  function tile(id: DeviceOs): ReactNode {
    if (!p || !data) return null;
    const current = os === id;
    switch (id) {
      case "windows":
        return (
          <Tile key={id} title="Windows" current={current}>
            {p.windows ? (
              <>
                <DownloadButton href="/api/desktop/download/windows">{t("clients.windowsExe")}</DownloadButton>
                <Hint>{fileLabel(p.windows)}</Hint>
                <Hint>{t("clients.windowsHint")}</Hint>
                {p["windows-msi"] ? (
                  <a className={LINK} href="/api/desktop/download/windows-msi" download>
                    {t("clients.windowsMsi")}
                  </a>
                ) : null}
              </>
            ) : (
              missing
            )}
          </Tile>
        );
      case "macos": {
        const manual = p.macos ? (
          <ol className="list-decimal space-y-2 pl-4">
            <li>
              <a className="text-primary underline-offset-4 hover:underline" href="/api/desktop/download/macos" download>
                {t("clients.macDmg")}
              </a>{" "}
              ({fileLabel(p.macos)})
            </li>
            <li>{t("clients.macDrag")}</li>
            <li>
              {t("clients.macQuarantine")}
              <CopyLine text={MAC_UNQUARANTINE} />
            </li>
          </ol>
        ) : null;
        return (
          <Tile key={id} title="macOS" current={current}>
            {p["macos-app"] ? (
              <>
                <DownloadButton href={macScriptHref} filename="install-proxora-macos.sh">
                  {t("clients.macScript")}
                </DownloadButton>
                <ol className="list-decimal space-y-2 pl-4 text-xs text-muted-foreground">
                  <li>{t("clients.macStep1")}</li>
                  <li>
                    {t("clients.macStep2")}
                    <CopyLine text={MAC_RUN} />
                  </li>
                  <li>{t("clients.macStep3")}</li>
                </ol>
                {origin.startsWith("https:") ? <Hint>{t("clients.macTls")}</Hint> : null}
                {manual ? (
                  <details className="text-xs text-muted-foreground">
                    <summary className="cursor-pointer text-foreground">{t("clients.macManual")}</summary>
                    <div className="mt-2">{manual}</div>
                  </details>
                ) : null}
              </>
            ) : manual ? (
              <div className="text-xs text-muted-foreground">{manual}</div>
            ) : (
              missing
            )}
          </Tile>
        );
      }
      case "linux": {
        const appImage = p["linux-appimage"];
        return (
          <Tile key={id} title="Linux" current={current}>
            {appImage || p["linux-deb"] || p["linux-rpm"] ? (
              <>
                {appImage ? (
                  <>
                    <DownloadButton href="/api/desktop/download/linux-appimage">{t("clients.linuxAppImage")}</DownloadButton>
                    <Hint>{fileLabel(appImage)}</Hint>
                    <div className="text-xs text-muted-foreground">
                      {t("clients.linuxHint")}
                      <CopyLine text={LINUX_CHMOD} />
                    </div>
                  </>
                ) : null}
                {p["linux-deb"] ? (
                  <a className={LINK} href="/api/desktop/download/linux-deb" download>
                    {t("clients.linuxDeb")}
                  </a>
                ) : null}
                {p["linux-rpm"] ? (
                  <a className={LINK} href="/api/desktop/download/linux-rpm" download>
                    {t("clients.linuxRpm")}
                  </a>
                ) : null}
                <Hint>{t("clients.linuxUpdate")}</Hint>
              </>
            ) : (
              missing
            )}
          </Tile>
        );
      }
      case "android":
        return (
          <Tile key={id} title="Android" current={current}>
            {data.android ? (
              <>
                <DownloadButton href="/api/android/apk">{t("clients.androidApk")}</DownloadButton>
                <Hint>{t("clients.androidHint")}</Hint>
              </>
            ) : (
              missing
            )}
          </Tile>
        );
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle>{t("clients.title")}</CardTitle>
        {data ? (
          <div className="flex items-center gap-3">
            {data.releaseUrl ? (
              <a className={LINK} href={data.releaseUrl} target="_blank" rel="noreferrer">
                {t("clients.releaseNotes")}
              </a>
            ) : null}
            <Badge variant="success">v{data.version}</Badge>
          </div>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-muted-foreground">{t("clients.description")}</p>
        {isLoading ? <p className="text-muted-foreground">{t("clients.loading")}</p> : null}
        {isError && !data ? (
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-destructive">{t("clients.error")}</p>
            <Button size="sm" variant="outline" disabled={isFetching} onClick={() => void refetch()}>
              {t("common.retry")}
            </Button>
          </div>
        ) : null}
        {data ? <div className="grid gap-3 md:grid-cols-2">{order.map(tile)}</div> : null}
      </CardContent>
    </Card>
  );
}
