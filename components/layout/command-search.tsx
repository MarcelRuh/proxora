"use client";

import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { useI18n } from "@/components/i18n/locale-provider";
import type { MessageKey } from "@/lib/i18n/messages";

type SearchResponse = {
  hosts: Array<{ type: string; id: string; title: string; subtitle?: string; href?: string }>;
  vms: Array<{ type: string; id: string; title: string; subtitle?: string; href?: string }>;
  containers: Array<{ type: string; id: string; title: string; subtitle?: string; href?: string }>;
  storage: Array<{ type: string; id: string; title: string; subtitle?: string; href?: string }>;
};

export function CommandSearch({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { t } = useI18n();
  const [q, setQ] = useState("");
  const router = useRouter();
  const { data } = useQuery({
    queryKey: ["search", q],
    queryFn: () => api<SearchResponse>(`/api/search?q=${encodeURIComponent(q)}`),
    enabled: open && q.length > 0,
  });

  const groups: Array<{ labelKey: MessageKey; items: SearchResponse[keyof SearchResponse] }> = [
    { labelKey: "search.hosts", items: data?.hosts ?? [] },
    { labelKey: "search.vms", items: data?.vms ?? [] },
    { labelKey: "search.containers", items: data?.containers ?? [] },
    { labelKey: "search.storage", items: data?.storage ?? [] },
  ];

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setQ("");
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-w-xl p-0">
        <DialogHeader className="p-4 pb-0">
          <DialogTitle className="proxora-section text-xs">{t("search.title")}</DialogTitle>
        </DialogHeader>
        <div className="p-4 pt-2">
          <Input autoFocus placeholder={t("search.placeholder")} value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="mt-3 max-h-80 overflow-y-auto">
            {groups.map((g) =>
              g.items.length ? (
                <div key={g.labelKey} className="mb-3">
                  <p className="mb-1 text-[11px] font-semibold uppercase text-muted-foreground">{t(g.labelKey)}</p>
                  {g.items.map((item) => (
                    <button
                      key={item.id}
                      className="flex w-full flex-col rounded-md px-2 py-2 text-left hover:bg-muted"
                      onClick={() => {
                        onOpenChange(false);
                        router.push(item.href ?? (item.type === "host" ? `/hosts/${item.id}` : "/"));
                      }}
                    >
                      <span className="text-sm">{item.title}</span>
                      {item.subtitle ? <span className="text-xs text-muted-foreground">{item.subtitle}</span> : null}
                    </button>
                  ))}
                </div>
              ) : null,
            )}
            {q && !groups.some((g) => g.items.length) ? (
              <p className="py-8 text-center text-sm text-muted-foreground">{t("search.empty")}</p>
            ) : null}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
