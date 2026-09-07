"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { useI18n } from "@/components/i18n/locale-provider";
import { cn } from "@/lib/utils";

type InboxEvent = {
  id: string;
  title: string;
  message: string;
  href: string | null;
  readAt: string | null;
  createdAt: string;
};

type InboxPayload = {
  unread: number;
  events: InboxEvent[];
};

export function InboxMenu({ compact }: { compact?: boolean }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const { data } = useQuery({
    queryKey: ["inbox"],
    queryFn: () => api<InboxPayload>("/api/inbox"),
    refetchInterval: 30_000,
  });
  const mark = useMutation({
    mutationFn: (body: { ids?: string[]; all?: boolean }) =>
      api("/api/inbox", { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["inbox"] }),
  });

  useEffect(() => {
    if (!open) return;
    const onClick = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const unread = data?.unread ?? 0;
  const events = data?.events ?? [];

  return (
    <div ref={rootRef} className="relative">
      <Button
        type="button"
        variant="outline"
        size={compact ? "icon" : "sm"}
        className={cn(!compact && "w-full justify-start gap-2")}
        onClick={() => setOpen((value) => !value)}
        aria-label={t("inbox.title")}
      >
        <Bell className="h-4 w-4" />
        {!compact ? <span className="flex-1 text-left">{t("inbox.title")}</span> : null}
        {unread > 0 ? (
          <span className="rounded-full border border-warning/50 bg-warning/10 px-1.5 py-0.5 text-[10px] font-semibold text-warning">
            {unread > 99 ? "99+" : unread}
          </span>
        ) : null}
      </Button>
      {open ? (
        <div className={cn(
          "absolute z-50 mt-2 w-[min(calc(100vw-2rem),22rem)] overflow-hidden rounded-[var(--ui-radius-panel)] border border-border bg-card shadow-[var(--ui-dialog-shadow)]",
          compact ? "right-0" : "left-0",
        )}>
          <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
            <p className="text-sm font-semibold">{t("inbox.title")}</p>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={!unread || mark.isPending}
              onClick={() => mark.mutate({ all: true })}
            >
              {t("inbox.markAll")}
            </Button>
          </div>
          <div className="max-h-[min(60vh,24rem)] overflow-y-auto">
            {events.length === 0 ? (
              <p className="px-3 py-6 text-sm text-muted-foreground">{t("inbox.empty")}</p>
            ) : (
              events.map((event) => {
                const inner = (
                  <>
                    <p className={cn("text-sm", event.readAt ? "text-muted-foreground" : "font-medium")}>{event.title}</p>
                    <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{event.message}</p>
                  </>
                );
                const className = "block border-b border-border px-3 py-2 last:border-b-0 hover:bg-muted/40";
                if (event.href) {
                  return (
                    <Link
                      key={event.id}
                      href={event.href}
                      className={className}
                      onClick={() => {
                        if (!event.readAt) mark.mutate({ ids: [event.id] });
                        setOpen(false);
                      }}
                    >
                      {inner}
                    </Link>
                  );
                }
                return (
                  <button
                    key={event.id}
                    type="button"
                    className={`${className} w-full text-left`}
                    onClick={() => {
                      if (!event.readAt) mark.mutate({ ids: [event.id] });
                    }}
                  >
                    {inner}
                  </button>
                );
              })
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
