"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowDownAZ,
  Box,
  Copy,
  Cpu,
  ExternalLink,
  Flame,
  FlaskConical,
  History,
  KeyRound,
  LayoutGrid,
  Monitor,
  Package,
  Play,
  Puzzle,
  RefreshCw,
  Search,
  Server,
  Sparkles,
  TrendingDown,
  X,
  type LucideIcon,
} from "lucide-react";
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
  CommunityScriptFlag,
  CommunityScriptKind,
  CommunityScriptSort,
  CommunityScriptSummary,
} from "@/lib/community-scripts";
import {
  COMMUNITY_SCRIPTS_SITE,
  COMMUNITY_SCRIPT_FLAGS,
  COMMUNITY_SCRIPT_SORTS,
  communityScriptFacetCounts,
  filterCommunityScripts,
  sortCommunityScripts,
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
  hasInstallStats?: boolean;
};

type RunResponse = {
  mode: "console";
  node: string;
  command: string;
  pageUrl: string;
  script: CommunityScriptSummary;
};

const KIND_OPTIONS: CommunityScriptKind[] = ["lxc", "vm", "addon", "pve", "turnkey"];
const PAGE_SIZE = 48;
const NEW_WINDOW_MS = 30 * 24 * 60 * 60_000;
const SORT_STORAGE_KEY = "proxora.cs.sort";
const STATS_SORTS = new Set<CommunityScriptSort>(["popular", "least"]);

const SORT_ICONS: Record<CommunityScriptSort, LucideIcon> = {
  category: LayoutGrid,
  popular: Flame,
  newest: Sparkles,
  updated: History,
  least: TrendingDown,
  name: ArrowDownAZ,
};
const KIND_ICONS: Record<CommunityScriptKind, LucideIcon> = {
  lxc: Box,
  vm: Monitor,
  addon: Puzzle,
  pve: Server,
  turnkey: Package,
};
const FLAG_ICONS: Record<CommunityScriptFlag, LucideIcon> = {
  arm: Cpu,
  testing: FlaskConical,
  oidc: KeyRound,
};

function readStoredSort(): CommunityScriptSort | null {
  try {
    const raw = window.localStorage.getItem(SORT_STORAGE_KEY);
    return raw && (COMMUNITY_SCRIPT_SORTS as string[]).includes(raw) ? (raw as CommunityScriptSort) : null;
  } catch {
    return null;
  }
}

function storeSort(sort: CommunityScriptSort) {
  try {
    window.localStorage.setItem(SORT_STORAGE_KEY, sort);
  } catch {
    // storage blocked: sort just isn't remembered
  }
}

function toggle<T>(list: T[], item: T): T[] {
  return list.includes(item) ? list.filter((x) => x !== item) : [...list, item];
}

function FilterChip({
  active,
  icon: Icon,
  label,
  count,
  onClick,
}: {
  active: boolean;
  icon: LucideIcon;
  label: string;
  count: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      disabled={!active && count === 0}
      onClick={onClick}
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40",
        active
          ? "border-primary/60 bg-primary/15 text-foreground"
          : "border-border bg-foreground/[0.02] text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground",
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
      <span
        className={cn(
          "rounded-full px-1.5 text-[10px] tabular-nums",
          active ? "bg-primary/25 text-foreground" : "bg-foreground/[0.07]",
        )}
      >
        {count}
      </span>
    </button>
  );
}

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
  const { t, locale } = useI18n();
  const canConsole = useCan("hosts.console", hostId || undefined);
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [kinds, setKinds] = useState<CommunityScriptKind[]>([]);
  const [flags, setFlags] = useState<CommunityScriptFlag[]>([]);
  const [sort, setSortState] = useState<CommunityScriptSort>("popular");
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
    const stored = readStoredSort();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage is client-only; read after mount to avoid hydration drift
    if (stored) setSortState(stored);
  }, []);

  useEffect(() => {
    setVisible(PAGE_SIZE);
  }, [debounced, categoryId, kinds, flags, sort]);

  function setSort(next: CommunityScriptSort) {
    setSortState(next);
    storeSort(next);
  }

  const activeHost = hosts.find((host) => host.id === hostId) ?? null;
  const hostOnline = activeHost?.connectionState === "ONLINE";
  const peerOk = activeHost ? peerHostAllowsPermission(activeHost, "hosts.console") : true;
  const canRun = Boolean(canConsole && hostOnline && peerOk && hostId);

  const { data, isLoading, isFetching, error, refetch, isError } = useQuery({
    queryKey: ["community-scripts"],
    queryFn: () => api<CatalogResponse>("/api/community-scripts"),
    staleTime: 5 * 60_000,
  });

  const hasStats = data?.hasInstallStats === true;
  const sortOptions = COMMUNITY_SCRIPT_SORTS.filter((item) => hasStats || !STATS_SORTS.has(item));
  const effectiveSort: CommunityScriptSort = sortOptions.includes(sort) ? sort : "newest";
  const categories = useMemo(() => data?.categories ?? [], [data?.categories]);
  const filter = useMemo(
    () => ({ query: debounced, categoryId: categoryId || undefined, kinds, flags }),
    [debounced, categoryId, kinds, flags],
  );
  const scripts = useMemo(
    () => sortCommunityScripts(filterCommunityScripts(data?.scripts ?? [], filter), effectiveSort, categories),
    [data?.scripts, filter, effectiveSort, categories],
  );
  const facets = useMemo(() => communityScriptFacetCounts(data?.scripts ?? [], filter), [data?.scripts, filter]);
  const shown = scripts.slice(0, visible);
  const filtersActive = Boolean(debounced || categoryId || kinds.length || flags.length);
  const categoryById = useMemo(() => new Map(categories.map((item) => [item.id, item.name])), [categories]);
  const categoryName = (ids: string[]) => ids.map((id) => categoryById.get(id)).filter(Boolean).join(", ");
  const groupByCategory = effectiveSort === "category" && !categoryId;
  const categoryOrder = useMemo(() => new Map(categories.map((cat, index) => [cat.id, index])), [categories]);
  const primaryCategory = (script: CommunityScriptSummary) =>
    [...script.categoryIds].sort((a, b) => (categoryOrder.get(a) ?? 9_999) - (categoryOrder.get(b) ?? 9_999))[0] ??
    "";
  const compact = useMemo(
    () => new Intl.NumberFormat(locale),
    [locale],
  );
  // eslint-disable-next-line react-hooks/purity -- "new" badge only needs render-time precision
  const now = Date.now();

  function clearFilters() {
    setQuery("");
    setDebounced("");
    setCategoryId("");
    setKinds([]);
    setFlags([]);
  }

  async function refreshCatalog() {
    try {
      await api<CatalogResponse>("/api/community-scripts?refresh=1");
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

      <div className="space-y-3 rounded-[var(--ui-radius)] border border-border bg-foreground/[0.02] p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div
            role="tablist"
            aria-label={t("cs.sortLabel")}
            className="flex flex-wrap gap-1 rounded-[var(--ui-radius)] border border-border bg-background/40 p-1"
          >
            {sortOptions.map((item) => {
              const Icon = SORT_ICONS[item];
              const active = item === effectiveSort;
              return (
                <button
                  key={item}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setSort(item)}
                  className={cn(
                    "inline-flex h-8 items-center gap-1.5 rounded-[calc(var(--ui-radius)-2px)] px-3 text-xs font-medium transition-colors",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    active
                      ? "bg-foreground/[0.09] text-foreground shadow-sm"
                      : "text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground",
                  )}
                >
                  <Icon className={cn("h-3.5 w-3.5", active && "text-primary")} />
                  {t(`cs.sort.${item}`)}
                </button>
              );
            })}
          </div>
          {filtersActive ? (
            <Button type="button" size="sm" variant="ghost" className="gap-1 text-muted-foreground" onClick={clearFilters}>
              <X className="h-3.5 w-3.5" />
              {t("cs.clearAll")}
            </Button>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {KIND_OPTIONS.map((item) => (
            <FilterChip
              key={item}
              active={kinds.includes(item)}
              icon={KIND_ICONS[item]}
              label={t(`cs.kindChip.${item}`)}
              count={facets.kinds[item]}
              onClick={() => setKinds((list) => toggle(list, item))}
            />
          ))}
          <span aria-hidden className="mx-1 hidden h-5 w-px bg-border sm:block" />
          {COMMUNITY_SCRIPT_FLAGS.map((item) => (
            <FilterChip
              key={item}
              active={flags.includes(item)}
              icon={FLAG_ICONS[item]}
              label={t(`cs.flag.${item}`)}
              count={facets.flags[item]}
              onClick={() => setFlags((list) => toggle(list, item))}
            />
          ))}
        </div>
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

      {!isLoading && !isError && data && scripts.length === 0 ? (
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <span>{t("cs.empty")}</span>
          {filtersActive ? (
            <Button type="button" size="sm" variant="outline" onClick={clearFilters}>
              {t("cs.clearAll")}
            </Button>
          ) : null}
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {shown.map((script, index) => {
          const resources = resourcesLabel(script);
          const group = groupByCategory ? primaryCategory(script) : "";
          const newGroup = groupByCategory && (index === 0 || primaryCategory(shown[index - 1]) !== group);
          const isNew = script.createdAt != null && now - script.createdAt < NEW_WINDOW_MS;
          return (
            <Fragment key={script.id}>
              {newGroup ? (
                <h3 className="col-span-full pt-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground first:pt-0">
                  {categoryById.get(group) ?? t("cs.uncategorized")}
                </h3>
              ) : null}
              <Card className="overflow-hidden">
                <CardContent className="flex h-full flex-col gap-3 p-4">
                  <div className="flex items-start gap-3">
                    <ScriptLogo name={script.name} logo={script.logo} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <p className="truncate text-sm font-medium">{script.name}</p>
                        {isNew ? (
                          <span className="shrink-0 rounded-full bg-primary/15 px-1.5 text-[10px] font-medium text-primary">
                            {t("cs.badgeNew")}
                          </span>
                        ) : null}
                        {script.isDev ? (
                          <span className="shrink-0 rounded-full bg-warning/15 px-1.5 text-[10px] font-medium text-warning">
                            {t("cs.flag.testing")}
                          </span>
                        ) : null}
                      </div>
                      <p className="truncate text-[11px] uppercase tracking-wide text-muted-foreground">
                        {t(`cs.kind.${script.kind}`)}
                        {categoryName(script.categoryIds) ? ` · ${categoryName(script.categoryIds)}` : ""}
                      </p>
                    </div>
                    {hasStats && script.installs30d ? (
                      <span
                        className="shrink-0 text-[11px] tabular-nums text-muted-foreground"
                        title={t("cs.installsTitle", { count: String(script.installs30d) })}
                      >
                        {t("cs.installs30d", { count: compact.format(script.installs30d) })}
                      </span>
                    ) : null}
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
            </Fragment>
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
          {t("cs.count", { shown: String(Math.min(visible, scripts.length)), total: String(scripts.length) })}
          {scripts.length !== data.total ? ` · ${t("cs.ofCatalog", { total: String(data.total) })}` : ""}
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
