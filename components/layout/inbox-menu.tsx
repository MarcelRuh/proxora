"use client";

import Link from "next/link";
import { Bell } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useI18n } from "@/components/i18n/locale-provider";
import { cn } from "@/lib/utils";

export type InboxEvent = {
  id: string;
  topic: string;
  level: string;
  title: string;
  message: string;
  href: string | null;
  readAt: string | null;
  createdAt: string;
};

export function useInbox() {
  return useQuery({
    queryKey: ["inbox"],
    queryFn: () => api<{ unread: number; events: InboxEvent[] }>("/api/inbox"),
    refetchInterval: 30_000,
    retry: false,
  });
}

export function InboxMenu() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const { data } = useInbox();
  const [open, setOpen] = useState(false);
  const unread = data?.unread ?? 0;
  const events = data?.events ?? [];

  async function markAll() {
    await api("/api/inbox", { method: "PATCH", body: JSON.stringify({ all: true }) });
    await qc.invalidateQueries({ queryKey: ["inbox"] });
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex h-9 w-full items-center gap-2 rounded-[4px] border border-primary/40 px-3 text-xs font-semibold uppercase tracking-wider text-sidebar-muted hover:border-primary hover:text-white"
        >
          <Bell className="h-3.5 w-3.5" />
          {t("inbox.title")}
          {unread ? (
            <span className="ml-auto rounded-full border border-warning/50 bg-warning/10 px-1.5 py-0.5 text-[10px] text-warning">
              {unread}
            </span>
          ) : null}
        </button>
      </PopoverTrigger>
      <PopoverContent className="flex max-h-[min(24rem,calc(100dvh-1.5rem))] flex-col overflow-hidden">
        <div className="mb-2 flex shrink-0 items-center justify-between gap-2 px-1">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-sidebar-muted">{t("inbox.title")}</p>
          {unread ? (
            <Button type="button" size="sm" variant="outline" onClick={() => void markAll()}>
              {t("inbox.markAll")}
            </Button>
          ) : null}
        </div>
        <div className="min-h-0 flex-1 space-y-1 overflow-y-auto">
          {events.length === 0 ? (
            <p className="px-1 py-4 text-xs text-sidebar-muted">{t("inbox.empty")}</p>
          ) : (
            events.map((event) => {
              const body = (
                <div className={cn("rounded-[4px] px-2 py-1.5", event.readAt ? "opacity-70" : "bg-primary/10")}>
                  <p className="text-xs font-medium text-white">{event.title}</p>
                  <p className="text-[11px] text-sidebar-muted">{event.message}</p>
                </div>
              );
              return event.href ? (
                <Link key={event.id} href={event.href} onClick={() => setOpen(false)}>
                  {body}
                </Link>
              ) : (
                <div key={event.id}>{body}</div>
              );
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
