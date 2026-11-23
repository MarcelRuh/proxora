"use client";

import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/api";
import { useI18n } from "@/components/i18n/locale-provider";
import type { DesktopPlatform } from "@/lib/desktop-clients";

type ClientsResponse = {
  version: string;
  tag: string;
  releaseUrl: string | null;
  platforms: Record<DesktopPlatform, { name: string; size: number } | null>;
  android: boolean;
};

const MAC_RUN = "bash ~/Downloads/install-proxora-macos.sh";
const MAC_UNQUARANTINE = "xattr -dr com.apple.quarantine /Applications/Proxora.app";

function sizeLabel(bytes: number): string {
  return bytes > 0 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : "";
}

function CopyLine({ text }: { text: string }) {
  const { t } = useI18n();
  return (
    <div className="flex items-center gap-2">
      <code className="min-w-0 flex-1 select-all overflow-x-auto whitespace-nowrap rounded-md bg-muted px-2 py-1.5 font-mono text-xs">
        {text}
      </code>
      <Button
        size="sm"
        variant="ghost"
        onClick={() => {
          // Clipboard API needs HTTPS; plain-HTTP LAN installs fall back to manual selection.
          if (!navigator.clipboard) {
            toast.error(t("clients.copyFailed"));
            return;
          }
          void navigator.clipboard.writeText(text).then(
            () => toast.success(t("clients.copied")),
            () => toast.error(t("clients.copyFailed")),
          );
        }}
      >
        {t("clients.copy")}
      </Button>
    </div>
  );
}

function Tile({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3 rounded-[var(--ui-radius)] border border-border/60 p-4">
      <h3 className="text-sm font-semibold">{title}</h3>
      {children}
    </section>
  );
}

export function ClientDownloadsSection() {
  const { t } = useI18n();
  const { data, isLoading, isError } = useQuery({
    queryKey: ["desktop-clients"],
    queryFn: () => api<ClientsResponse>("/api/desktop/clients"),
    staleTime: 5 * 60_000,
  });
  const p = data?.platforms;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>{t("clients.title")}</CardTitle>
        {data ? <Badge variant="success">v{data.version}</Badge> : null}
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-muted-foreground">{t("clients.description")}</p>
        {isLoading ? <p className="text-muted-foreground">{t("clients.loading")}</p> : null}
        {isError ? <p className="text-destructive">{t("clients.error")}</p> : null}
        {data ? (
          <div className="grid gap-3 lg:grid-cols-3">
            <Tile title="Windows">
              {p?.windows ? (
                <>
                  <Button size="sm" asChild className="self-start">
                    <a href="/api/desktop/download/windows" download>
                      {t("clients.windowsExe")}
                    </a>
                  </Button>
                  <p className="text-xs text-muted-foreground">
                    {p.windows.name} · {sizeLabel(p.windows.size)}
                  </p>
                  <p className="text-xs text-muted-foreground">{t("clients.windowsHint")}</p>
                  {p["windows-msi"] ? (
                    <a className="text-xs text-primary underline-offset-4 hover:underline" href="/api/desktop/download/windows-msi" download>
                      {t("clients.windowsMsi")}
                    </a>
                  ) : null}
                </>
              ) : (
                <p className="text-xs text-muted-foreground">{t("clients.notYet")}</p>
              )}
            </Tile>
            <Tile title="macOS">
              {p?.["macos-app"] ? (
                <>
                  <Button size="sm" asChild className="self-start">
                    <a href="/api/desktop/install-macos" download="install-proxora-macos.sh">
                      {t("clients.macScript")}
                    </a>
                  </Button>
                  <ol className="list-decimal space-y-2 pl-4 text-xs text-muted-foreground">
                    <li>{t("clients.macStep1")}</li>
                    <li>
                      {t("clients.macStep2")}
                      <CopyLine text={MAC_RUN} />
                    </li>
                    <li>{t("clients.macStep3")}</li>
                  </ol>
                  {p.macos ? (
                    <details className="text-xs text-muted-foreground">
                      <summary className="cursor-pointer text-foreground">{t("clients.macManual")}</summary>
                      <ol className="mt-2 list-decimal space-y-2 pl-4">
                        <li>
                          <a className="text-primary underline-offset-4 hover:underline" href="/api/desktop/download/macos" download>
                            {t("clients.macDmg")}
                          </a>{" "}
                          ({sizeLabel(p.macos.size)})
                        </li>
                        <li>{t("clients.macDrag")}</li>
                        <li>
                          {t("clients.macQuarantine")}
                          <CopyLine text={MAC_UNQUARANTINE} />
                        </li>
                      </ol>
                    </details>
                  ) : null}
                </>
              ) : (
                <p className="text-xs text-muted-foreground">{t("clients.notYet")}</p>
              )}
            </Tile>
            <Tile title="Android">
              {data.android ? (
                <>
                  <Button size="sm" asChild className="self-start">
                    <a href="/api/android/apk" download>
                      {t("clients.androidApk")}
                    </a>
                  </Button>
                  <p className="text-xs text-muted-foreground">{t("clients.androidHint")}</p>
                </>
              ) : (
                <p className="text-xs text-muted-foreground">{t("clients.notYet")}</p>
              )}
            </Tile>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
