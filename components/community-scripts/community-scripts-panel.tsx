"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Copy, ExternalLink, Play, RefreshCw, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { WebConsole } from "@/components/console/web-console";
import { api } from "@/lib/api";
import { useI18n } from "@/components/i18n/locale-provider";
import { useCan } from "@/components/auth/session-user";
import { peerHostAllowsPermission } from "@/lib/federation-access";
import type { PublicHost } from "@/lib/types";
import type {
  CommunityScriptCategory,
  CommunityScriptKind,
  CommunityScriptSummary,
} from "@/lib/community-scripts";
import {
  COMMUNITY_SCRIPTS_SITE,
  communityScriptInstallCommand,
  communityScriptLogoSrc,
  communityScriptPageUrl,
  communityScriptRawUrl,
} from "@/lib/community-scripts";
import { openExternalUrl } from "@/lib/open-external-url";
import { cn } from "@/lib/utils";

type CatalogResponse = {
  scripts: CommunityScriptSummary[];
  categories: CommunityScriptCategory[];
  fetchedAt: number;
  total: number;
  stale?: boolean;
};

type RunResponse = {
  mode: "console";
  node: string;
  command: string;
  pageUrl: string;
  script: CommunityScriptSummary;
};

const KIND_OPTIONS: Array<CommunityScriptKind | "all"> = ["all", "lxc", "vm", "addon", "pve", "turnkey"];
const PAGE_SIZE = 48;

function resourcesLabel(script: CommunityScriptSummary): string | null {
  const parts: string[] = [];
  if (script.defaultCpu) parts.push(`${script.defaultCpu} CPU`);
  if (script.defaultRamMb) parts.push(`${script.defaultRamMb} MB`);
  if (script.defaultDiskGb) parts.push(`${script.defaultDiskGb} GB`);
  if (script.defaultOs) parts.push(script.defaultOs);
  return parts.length ? parts.join(" · ") : null;
}

function ScriptLogo({ name, logo }: { name: string; logo: string | null }) {
  const [failed, setFailed] = useState(false);
  const src = communityScriptLogoSrc(logo);
  if (!src || failed) {
    return (
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--ui-radius)] bg-foreground/[0.06] text-xs font-semibold text-muted-foreground">
        {name.trim().slice(0, 1).toUpperCase() || "?"}
      </div>
    );
  }
  return (
    <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded-[var(--ui-radius)] bg-foreground/[0.04]">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt=""
        className="h-full w-full object-contain p-1"
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
      />
    </div>
  );
}

async function copyText(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    try {
      const area = document.createElement("textarea");
      area.value = value;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.left = "-9999px";
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand("copy");
      area.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

export function CommunityScriptsPanel({
  hosts,
  hostId,
  onHostChange,
}: {
  hosts: PublicHost[];
  hostId: string;
  onHostChange: (id: string) => void;
}) {
  const { t } = useI18n();
  const canConsole = useCan("hosts.console", hostId || undefined);
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [kind, setKind] = useState<CommunityScriptKind | "all">("all");
  const [visible, setVisible] = useState(PAGE_SIZE);
  const [selected, setSelected] = useState<CommunityScriptSummary | null>(null);
  const [detail, setDetail] = useState<CommunityScriptSummary | null>(null);
  const [running, setRunning] = useState(false);
  const [shell, setShell] = useState<{ hostId: string; node: string; command: string; name: string } | null>(
    null,
  );

  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(query.trim()), 200);
    return () => window.clearTimeout(id);
  }, [query]);

  useEffect(() => {
    setVisible(PAGE_SIZE);
  }, [debounced, categoryId, kind]);

  const activeHost = hosts.find((host) => host.id === hostId) ?? null;
  const hostOnline = activeHost?.connectionState === "ONLINE";
  const peerOk = activeHost ? peerHostAllowsPermission(activeHost, "hosts.console") : true;
  const canRun = Boolean(canConsole && hostOnline && peerOk && hostId);

  const catalogKey = ["community-scripts", debounced, categoryId, kind] as const;
  const { data, isLoading, isFetching, error, refetch, isError } = useQuery({
    queryKey: catalogKey,
    queryFn: () => {
      const params = new URLSearchParams();
      if (debounced) params.set("q", debounced);
      if (categoryId) params.set("category", categoryId);
      if (kind !== "all") params.set("kind", kind);
      const qs = params.toString();
      return api<CatalogResponse>(`/api/community-scripts${qs ? `?${qs}` : ""}`);
    },
    staleTime: 5 * 60_000,
  });

  const scripts = data?.scripts ?? [];
  const shown = scripts.slice(0, visible);
  const categories = data?.categories ?? [];
  const categoryName = useMemo(() => {
    const map = new Map(categories.map((item) => [item.id, item.name]));
    return (ids: string[]) => ids.map((id) => map.get(id)).filter(Boolean).join(", ");
  }, [categories]);

  async function refreshCatalog() {
    const params = new URLSearchParams();
    if (debounced) params.set("q", debounced);
    if (categoryId) params.set("category", categoryId);
    if (kind !== "all") params.set("kind", kind);
    params.set("refresh", "1");
    try {
      await api<CatalogResponse>(`/api/community-scripts?${params}`);
      await refetch();
      toast.success(t("cs.refreshDone"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("cs.loadFailed"));
    }
  }

  async function startInstall(script: CommunityScriptSummary) {
    if (!canRun || running) return;
    setRunning(true);
    try {
      const result = await api<RunResponse>(`/api/hosts/${hostId}/community-scripts/run`, {
        method: "POST",
        body: JSON.stringify({ slug: script.slug, confirm: true }),
      });
      setSelected(null);
      setShell({
        hostId,
        node: result.node,
        command: result.command,
        name: result.script.name,
      });
      toast.success(t("cs.installStarted", { name: result.script.name }));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("cs.installFailed"));
    } finally {
      setRunning(false);
    }
  }

  function openLink(url: string, label: string) {
    const ok = openExternalUrl(url);
    if (ok) toast.message(t("cs.openingLink", { label }));
    else toast.error(t("cs.openLinkFailed"));
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {hosts.length > 1 ? (
          <select
            className="h-9 rounded-[var(--ui-radius)] border border-input bg-foreground/[0.03] px-2 text-sm"
            value={hostId}
            onChange={(e) => onHostChange(e.target.value)}
          >
            {hosts.map((host) => (
              <option key={host.id} value={host.id}>
                {host.name}
              </option>
            ))}
          </select>
        ) : null}
        <div className="relative min-w-[14rem] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-8"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("cs.search")}
          />
        </div>
        <select
          className="h-9 rounded-[var(--ui-radius)] border border-input bg-foreground/[0.03] px-2 text-sm"
          value={kind}
          onChange={(e) => setKind(e.target.value as CommunityScriptKind | "all")}
        >
          {KIND_OPTIONS.map((item) => (
            <option key={item} value={item}>
              {t(`cs.kind.${item}`)}
            </option>
          ))}
        </select>
        <select
          className="h-9 max-w-[16rem] rounded-[var(--ui-radius)] border border-input bg-foreground/[0.03] px-2 text-sm"
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
        >
          <option value="">{t("cs.allCategories")}</option>
          {categories.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
        <Button
          type="button"
          variant="outline"
          size="icon"
          title={t("cs.refresh")}
          disabled={isFetching}
          onClick={() => void refreshCatalog()}
        >
          <RefreshCw className={cn("h-4 w-4", isFetching && "animate-spin")} />
        </Button>
        <Button
          type="button"
          variant="outline"
          className="gap-1 text-muted-foreground"
          onClick={() => openLink(COMMUNITY_SCRIPTS_SITE, "community-scripts.org")}
        >
          community-scripts.org
          <ExternalLink className="h-3.5 w-3.5" />
        </Button>
      </div>

      {!canRun ? (
        <p className="text-sm text-muted-foreground">
          {!hostId
            ? t("cs.noHost")
            : !hostOnline
              ? t("cs.hostOffline")
              : !canConsole || !peerOk
                ? t("cs.noConsole")
                : null}
        </p>
      ) : null}

      {data?.stale ? <p className="text-sm text-warning">{t("cs.staleCache")}</p> : null}

      {isError ? (
        <div className="flex flex-wrap items-center gap-2 text-sm text-destructive">
          <span>{error instanceof Error ? error.message : t("cs.loadFailed")}</span>
          <Button type="button" size="sm" variant="outline" onClick={() => void refreshCatalog()}>
            {t("cs.retry")}
          </Button>
        </div>
      ) : null}
      {isLoading ? <p className="text-sm text-muted-foreground">{t("common.loading")}</p> : null}

      {!isLoading && !isError && scripts.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("cs.empty")}</p>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {shown.map((script) => {
          const resources = resourcesLabel(script);
          return (
            <Card key={script.id} className="overflow-hidden">
              <CardContent className="flex h-full flex-col gap-3 p-4">
                <div className="flex items-start gap-3">
                  <ScriptLogo name={script.name} logo={script.logo} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{script.name}</p>
                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                      {t(`cs.kind.${script.kind}`)}
                      {categoryName(script.categoryIds) ? ` · ${categoryName(script.categoryIds)}` : ""}
                    </p>
                  </div>
                </div>
                <p className="line-clamp-3 flex-1 text-xs text-muted-foreground">{script.description || "—"}</p>
                {resources ? <p className="text-[11px] text-muted-foreground">{resources}</p> : null}
                <div className="flex flex-wrap gap-2">
                  <Button type="button" size="sm" disabled={!canRun || running} onClick={() => setSelected(script)}>
                    <Play className="mr-1 h-3.5 w-3.5" />
                    {t("cs.install")}
                  </Button>
                  <Button type="button" size="sm" variant="outline" onClick={() => setDetail(script)}>
                    {t("cs.details")}
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {scripts.length > visible ? (
        <div className="flex justify-center">
          <Button type="button" variant="outline" onClick={() => setVisible((n) => n + PAGE_SIZE)}>
            {t("cs.loadMore", { remaining: String(scripts.length - visible) })}
          </Button>
        </div>
      ) : null}

      {data ? (
        <p className="text-xs text-muted-foreground">
          {t("cs.count", { shown: String(Math.min(visible, scripts.length)), total: String(data.total) })}
        </p>
      ) : null}

      <Dialog open={Boolean(detail)} onOpenChange={(open) => !open && setDetail(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{detail?.name}</DialogTitle>
            <DialogDescription>
              {detail ? `${t(`cs.kind.${detail.kind}`)} · ${detail.slug}` : null}
            </DialogDescription>
          </DialogHeader>
          {detail ? (
            <div className="space-y-3 text-sm">
              <div className="flex items-start gap-3">
                <ScriptLogo name={detail.name} logo={detail.logo} />
                <p className="text-muted-foreground">{detail.description || "—"}</p>
              </div>
              <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                {resourcesLabel(detail) ? <span>{resourcesLabel(detail)}</span> : null}
                {detail.port ? <span>{t("cs.port", { port: String(detail.port) })}</span> : null}
                {detail.privileged ? <span>{t("cs.privileged")}</span> : null}
                {detail.updateable ? <span>{t("cs.updateable")}</span> : null}
              </div>
              <div className="space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-medium text-muted-foreground">{t("cs.installCommand")}</p>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2"
                    onClick={() => {
                      void copyText(communityScriptInstallCommand(detail.kind, detail.slug)).then((ok) => {
                        if (ok) toast.success(t("cs.copied"));
                        else toast.error(t("cs.copyFailed"));
                      });
                    }}
                  >
                    <Copy className="mr-1 h-3.5 w-3.5" />
                    {t("cs.copy")}
                  </Button>
                </div>
                <p className="break-all rounded-[var(--ui-radius)] border border-border bg-foreground/[0.03] p-2 font-mono text-[11px]">
                  {communityScriptInstallCommand(detail.kind, detail.slug)}
                </p>
              </div>
              <div className="flex flex-wrap justify-end gap-2">
                {detail.documentation ? (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => openLink(detail.documentation!, t("cs.openDocs"))}
                  >
                    {t("cs.openDocs")}
                    <ExternalLink className="h-3.5 w-3.5" />
                  </Button>
                ) : null}
                {detail.website ? (
                  <Button type="button" variant="outline" onClick={() => openLink(detail.website!, t("cs.openProject"))}>
                    {t("cs.openProject")}
                    <ExternalLink className="h-3.5 w-3.5" />
                  </Button>
                ) : null}
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => openLink(communityScriptPageUrl(detail.slug), t("cs.openWebsite"))}
                >
                  {t("cs.openWebsite")}
                  <ExternalLink className="h-3.5 w-3.5" />
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => openLink(communityScriptRawUrl(detail.kind, detail.slug), t("cs.openSource"))}
                >
                  {t("cs.openSource")}
                  <ExternalLink className="h-3.5 w-3.5" />
                </Button>
                <Button
                  type="button"
                  disabled={!canRun || running}
                  onClick={() => {
                    setDetail(null);
                    setSelected(detail);
                  }}
                >
                  <Play className="mr-1 h-3.5 w-3.5" />
                  {t("cs.install")}
                </Button>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(selected)} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{selected?.name}</DialogTitle>
            <DialogDescription>{t("cs.confirmBody")}</DialogDescription>
          </DialogHeader>
          {selected ? (
            <div className="space-y-3 text-sm">
              <p className="text-muted-foreground">{selected.description}</p>
              <p className="break-all rounded-[var(--ui-radius)] border border-border bg-foreground/[0.03] p-2 font-mono text-[11px]">
                {communityScriptInstallCommand(selected.kind, selected.slug)}
              </p>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setSelected(null)}>
                  {t("common.cancel")}
                </Button>
                <Button type="button" disabled={!canRun || running} onClick={() => void startInstall(selected)}>
                  {running ? t("common.loading") : t("cs.runOnHost")}
                </Button>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(shell)} onOpenChange={(open) => !open && setShell(null)}>
        <DialogContent className="max-w-5xl overflow-hidden p-0">
          <DialogHeader className="border-b border-border px-4 py-3">
            <DialogTitle>
              {shell ? t("cs.shellTitle", { name: shell.name, node: shell.node }) : t("cs.install")}
            </DialogTitle>
            <DialogDescription>{t("cs.shellBody")}</DialogDescription>
          </DialogHeader>
          {shell ? (
            <div className="h-[min(70vh,640px)] p-2">
              <WebConsole
                hostId={shell.hostId}
                node={shell.node}
                kind="node"
                initialInput={shell.command}
                fill
                onDisconnected={() => setShell(null)}
              />
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
