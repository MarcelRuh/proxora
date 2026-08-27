"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Activity,
  Box,
  Boxes,
  ClipboardList,
  HardDrive,
  LayoutDashboard,
  LogOut,
  Menu,
  Moon,
  RefreshCw,
  Search,
  Server,
  Settings,
  Shield,
  Sun,
  Users,
  Waves,
} from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState, type ComponentType, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import { CommandSearch } from "@/components/layout/command-search";
import type { SessionUser } from "@/lib/types";
import { APP_NAME, APP_VERSION } from "@/lib/version";
import { useQuery } from "@tanstack/react-query";
import type { SelfUpdateStatus } from "@/components/settings/self-update-section";
import { ProgressBar } from "@/components/ui/misc";

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  {
    label: "Infrastructure",
    items: [
      { href: "/hosts", label: "Hosts", icon: Server },
      { href: "/vms", label: "Virtual Machines", icon: Boxes },
      { href: "/containers", label: "Containers", icon: Box },
      { href: "/storage", label: "Storage", icon: HardDrive },
      { href: "/zfs", label: "ZFS", icon: Waves },
      { href: "/tasks", label: "Tasks", icon: Activity },
    ],
  },
  {
    label: "Management",
    items: [
      { href: "/updates", label: "Updates", icon: Shield },
      { href: "/users", label: "Users", icon: Users },
      { href: "/roles", label: "Roles", icon: Shield },
      { href: "/audit", label: "Audit Log", icon: ClipboardList },
    ],
  },
  {
    label: "Settings",
    items: [
      { href: "/settings", label: "General", icon: Settings },
      { href: "/proxora", label: "Proxora", icon: RefreshCw },
      { href: "/settings/notifications", label: "Notifications", icon: Activity },
      { href: "/settings/security", label: "Security", icon: Shield },
    ],
  },
];

export function AppShell({ children, user }: { children: ReactNode; user: SessionUser }) {
  const pathname = usePathname();
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

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
    <div className="flex min-h-screen bg-background">
      <aside
        className={cn(
          "fixed inset-y-0 z-40 flex w-64 flex-col border-r border-white/5 bg-sidebar text-sidebar-foreground transition-transform lg:static lg:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full lg:translate-x-0",
        )}
      >
        <div className="flex h-16 items-center gap-2 px-5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-teal-500/20 text-teal-300">
            <Server className="h-4 w-4" />
          </div>
          <div>
            <p className="text-sm font-semibold tracking-tight">{APP_NAME}</p>
            <p className="text-[11px] text-sidebar-muted">Multi-host Proxmox control</p>
          </div>
        </div>
        <nav className="flex-1 overflow-y-auto px-3 pb-6">
          {NAV.map((section) =>
            "href" in section ? (
              <NavLink key={section.href} href={section.href!} label={section.label} icon={section.icon!} active={pathname.startsWith(section.href!)} />
            ) : (
              <div key={section.label} className="mt-5">
                <p className="mb-1 px-2 text-[11px] font-semibold uppercase tracking-wider text-sidebar-muted">
                  {section.label}
                </p>
                <div className="space-y-0.5">
                  {section.items!.map((item) => (
                    <NavLink
                      key={item.href}
                      href={item.href}
                      label={item.label}
                      icon={item.icon}
                      active={pathname === item.href || pathname.startsWith(`${item.href}/`)}
                    />
                  ))}
                </div>
              </div>
            ),
          )}
        </nav>
        <div className="border-t border-white/5 p-3 text-xs text-sidebar-muted">
          Signed in as <span className="text-sidebar-foreground">{user.username}</span>
          <div className="mt-0.5">{user.role.name}</div>
          <SidebarVersion />
        </div>
      </aside>
      {open ? (
        <button className="fixed inset-0 z-30 bg-black/50 lg:hidden" onClick={() => setOpen(false)} />
      ) : null}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-border bg-background/80 px-4 backdrop-blur">
          <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setOpen(true)}>
            <Menu className="h-5 w-5" />
          </Button>
          <button
            onClick={() => setSearchOpen(true)}
            className="flex h-9 max-w-md flex-1 items-center gap-2 rounded-md border border-input bg-card px-3 text-sm text-muted-foreground"
          >
            <Search className="h-4 w-4" />
            Search hosts, VMs, containers…
            <kbd className="ml-auto hidden rounded border border-border px-1.5 text-[10px] sm:inline">Ctrl K</kbd>
          </button>
          <Button variant="ghost" size="icon" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
            <Sun className="hidden h-4 w-4 dark:block" />
            <Moon className="h-4 w-4 dark:hidden" />
          </Button>
          <Button variant="ghost" size="icon" onClick={logout} title="Sign out">
            <LogOut className="h-4 w-4" />
          </Button>
        </header>
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
}: {
  href: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors",
        active ? "bg-sidebar-accent text-white" : "text-sidebar-muted hover:bg-white/5 hover:text-white",
      )}
    >
      <Icon className="h-4 w-4" />
      {label}
    </Link>
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
    <Link href="/proxora" className="mt-3 block rounded-md bg-white/5 px-2 py-2 hover:bg-white/10">
      <div className="flex items-center justify-between gap-2 text-[11px]">
        <span className="font-mono text-sidebar-foreground">
          {status?.updateAvailable ? `${current} → ${target}` : `v${current}`}
        </span>
        {status?.updateAvailable ? (
          <span className="text-amber-300">Update</span>
        ) : (
          <span>GitHub</span>
        )}
      </div>
      <div className="mt-1.5">
        <ProgressBar
          className="h-1 bg-white/10"
          value={percent}
          autoTone={false}
          tone={status?.progress?.step === "error" ? "danger" : "primary"}
        />
      </div>
      <p className="mt-1 text-[10px]">
        {updating
          ? `${Math.round(percent)}% ${status?.progress?.step ?? "updating"}`
          : status?.updateAvailable
            ? "Update available"
            : "Up to date"}
      </p>
    </Link>
  );
}
