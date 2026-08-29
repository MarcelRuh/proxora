"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Archive,
  Activity,
  Box,
  Boxes,
  ClipboardList,
  HardDrive,
  LayoutDashboard,
  LogOut,
  Menu,
  Search,
  Server,
  Settings,
  Shield,
  ArrowUpCircle,
  Library,
  Users,
  X,
} from "lucide-react";
import { useEffect, useState, type ComponentType, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import { CommandSearch } from "@/components/layout/command-search";
import { AptUpdateBanner, useAptSummary } from "@/components/layout/apt-update-alert";
import { NeonAtmosphere } from "@/components/layout/neon-atmosphere";
import { BrandMark } from "@/components/layout/brand-mark";
import type { SessionUser } from "@/lib/types";
import { hasAnyPermission, hasPermission } from "@/lib/permissions";
import type { Permission } from "@/lib/permissions";
import { APP_NAME, APP_VERSION } from "@/lib/version";
import { useQuery } from "@tanstack/react-query";
import type { SelfUpdateStatus } from "@/components/settings/self-update-section";
import { ProgressBar } from "@/components/ui/misc";
import { useI18n } from "@/components/i18n/locale-provider";
import type { MessageKey } from "@/lib/i18n/messages";

const NAV: Array<{
  href: string;
  labelKey: MessageKey;
  icon: ComponentType<{ className?: string }>;
  anyOf: Permission[];
}> = [
  { href: "/dashboard", labelKey: "nav.dashboard", icon: LayoutDashboard, anyOf: ["hosts.view"] },
  { href: "/hosts", labelKey: "nav.hosts", icon: Server, anyOf: ["hosts.view"] },
  { href: "/vms", labelKey: "nav.vms", icon: Boxes, anyOf: ["vm.view"] },
  { href: "/containers", labelKey: "nav.containers", icon: Box, anyOf: ["lxc.view"] },
  { href: "/templates", labelKey: "nav.templates", icon: Library, anyOf: ["lxc.create", "vm.create"] },
  { href: "/storage", labelKey: "nav.storage", icon: HardDrive, anyOf: ["storage.view", "zfs.view"] },
  { href: "/backups", labelKey: "nav.backups", icon: Archive, anyOf: ["backup.view"] },
  { href: "/tasks", labelKey: "nav.tasks", icon: Activity, anyOf: ["tasks.view"] },
  { href: "/updates", labelKey: "nav.updates", icon: Shield, anyOf: ["updates.view"] },
  { href: "/proxora", labelKey: "nav.proxora", icon: ArrowUpCircle, anyOf: ["proxora.update", "updates.view"] },
  { href: "/users", labelKey: "nav.users", icon: Users, anyOf: ["users.view"] },
  { href: "/roles", labelKey: "nav.roles", icon: Shield, anyOf: ["roles.view"] },
  { href: "/audit", labelKey: "nav.audit", icon: ClipboardList, anyOf: ["audit.view"] },
  { href: "/settings", labelKey: "nav.settings", icon: Settings, anyOf: ["settings.view", "notifications.view"] },
];

export function AppShell({ children, user }: { children: ReactNode; user: SessionUser }) {
  const { t, locale, setLocale } = useI18n();
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  async function logout() {
    await api("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <div className="relative flex h-dvh overflow-hidden bg-background">
      <NeonAtmosphere />
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex h-dvh w-64 shrink-0 flex-col overflow-hidden border-r border-[rgba(131,56,236,0.2)] bg-sidebar text-sidebar-foreground backdrop-blur-md transition-transform lg:static lg:h-full lg:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full lg:translate-x-0",
        )}
      >
        <div className="flex shrink-0 items-center gap-3 px-4 py-5">
          <BrandMark className="h-11 w-11 drop-shadow-[0_0_16px_rgba(255,0,110,0.35)]" />
          <div>
            <p className="proxora-logo text-lg leading-none">{APP_NAME.toUpperCase()}</p>
            <p className="mt-1 text-[9px] font-semibold uppercase tracking-[0.22em] text-sidebar-muted">
              {t("nav.subtitle")}
            </p>
          </div>
        </div>
        <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
          {NAV.filter((item) => hasAnyPermission(user.role.permissions, item.anyOf)).map((item) => (
            <NavLink
              key={item.href}
              href={item.href}
              label={t(item.labelKey)}
              icon={item.icon}
              active={
                item.href === "/dashboard"
                  ? pathname === item.href
                  : pathname === item.href || pathname.startsWith(`${item.href}/`)
              }
              badge={
                item.href === "/updates" && hasPermission(user.role.permissions, "updates.view") ? (
                  <UpdatesBadge />
                ) : item.href === "/proxora" ? (
                  <ProxoraBadge />
                ) : undefined
              }
            />
          ))}
        </nav>
        <div className="shrink-0 space-y-2 border-t border-[rgba(131,56,236,0.2)] p-3">
          <button
            onClick={() => setSearchOpen(true)}
            className="flex h-9 w-full items-center gap-2 rounded-[4px] border border-primary/40 px-3 text-xs font-semibold uppercase tracking-wider text-sidebar-muted hover:border-primary hover:text-white"
          >
            <Search className="h-3.5 w-3.5" />
            {t("nav.search")}
            <kbd className="ml-auto text-[10px] text-sidebar-muted">⌘K</kbd>
          </button>
          {hasAnyPermission(user.role.permissions, ["proxora.update", "updates.view"]) ? <SidebarVersion /> : null}
          <div className="flex items-center gap-2 px-1 text-[11px] font-semibold uppercase tracking-wider">
            <button
              className={locale === "de" ? "text-primary" : "text-sidebar-muted hover:text-white"}
              onClick={() => setLocale("de")}
            >
              DE
            </button>
            <span className="text-sidebar-muted">/</span>
            <button
              className={locale === "en" ? "text-primary" : "text-sidebar-muted hover:text-white"}
              onClick={() => setLocale("en")}
            >
              EN
            </button>
          </div>
          <p className="px-1 text-[10px] text-sidebar-muted">
            {user.username} · {user.role.name}
          </p>
          <button
            onClick={() => void logout()}
            className="flex w-full items-center gap-2 px-3 py-2 text-xs font-semibold uppercase tracking-wider text-sidebar-muted hover:text-primary"
          >
            <LogOut className="h-3.5 w-3.5" />
            {t("nav.logout")}
          </button>
        </div>
      </aside>
      {open ? (
        <button className="fixed inset-0 z-30 bg-black/60 lg:hidden" onClick={() => setOpen(false)} />
      ) : null}
      <div className="relative z-10 flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">
        <header className="sticky top-0 z-20 flex items-center gap-3 bg-background/80 px-4 py-3 backdrop-blur-md lg:hidden">
          <Button variant="outline" size="icon" onClick={() => setOpen(true)}>
            {open ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          </Button>
          <BrandMark className="h-8 w-8" />
          <span className="proxora-logo text-sm">{APP_NAME.toUpperCase()}</span>
        </header>
        {hasPermission(user.role.permissions, "updates.view") ? <AptUpdateBanner /> : null}
        <main className="flex-1 p-4 md:p-6">{children}</main>
      </div>
      <CommandSearch open={searchOpen} onOpenChange={setSearchOpen} />
    </div>
  );
}

function NavLink({
  href,
  label,
  icon: Icon,
  active,
  badge,
}: {
  href: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  active: boolean;
  badge?: ReactNode;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "flex items-center gap-2.5 px-3 py-2.5 text-sm font-medium uppercase tracking-wide transition-colors",
        active ? "proxora-nav-active" : "text-sidebar-muted hover:bg-primary/10 hover:text-white hover:shadow-[0_0_16px_rgba(255,0,110,0.15)]",
      )}
    >
      <Icon className="h-4 w-4" />
      <span className="flex-1">{label}</span>
      {badge}
    </Link>
  );
}

function UpdatesBadge() {
  const { data } = useAptSummary();
  if (!data?.total) return null;
  return (
    <span className="rounded-full border border-warning/50 bg-warning/10 px-1.5 py-0.5 text-[10px] font-semibold text-warning">
      {data.total}
    </span>
  );
}

function ProxoraBadge() {
  const { data } = useQuery({
    queryKey: ["self-update"],
    queryFn: () => api<SelfUpdateStatus>("/api/system/self-update"),
    refetchInterval: (q) => (q.state.data?.updating ? 1500 : 60_000),
  });
  if (!data?.updateAvailable && !data?.updating) return null;
  return (
    <span className="rounded-full border border-warning/50 bg-warning/10 px-1.5 py-0.5 text-[10px] font-semibold text-warning">
      {data.updating ? "…" : "1"}
    </span>
  );
}

function SidebarVersion() {
  const { data: status } = useQuery({
    queryKey: ["self-update"],
    queryFn: () => api<SelfUpdateStatus>("/api/system/self-update"),
    refetchInterval: (q) => (q.state.data?.updating ? 1500 : 60_000),
  });
  const current = status?.currentVersion ?? APP_VERSION;
  const target = status?.targetVersion ?? current;
  const updating = Boolean(status?.updating);
  const percent = status?.progress?.percent ?? (updating ? 2 : status?.updateAvailable ? 8 : 100);
  return (
    <Link href="/proxora" className="block rounded-[4px] border border-[rgba(131,56,236,0.28)] px-2 py-2 hover:border-primary/50">
      <div className="flex items-center justify-between gap-2 text-[11px]">
        <span className="font-mono text-sidebar-foreground">
          {status?.updateAvailable ? `${current} → ${target}` : `v${current}`}
        </span>
        {status?.updateAvailable ? (
          <span className="text-warning">Update</span>
        ) : (
          <span className="text-sidebar-muted">GitHub</span>
        )}
      </div>
      <div className="mt-1.5">
        <ProgressBar
          className="h-1"
          value={percent}
          autoTone={false}
          tone={status?.progress?.step === "error" ? "danger" : "primary"}
        />
      </div>
    </Link>
  );
}
