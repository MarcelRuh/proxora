"use client";

import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";

type SearchResponse = {
  hosts: Array<{ type: string; id: string; title: string; subtitle?: string; href?: string }>;
  vms: Array<{ type: string; id: string; title: string; subtitle?: string; href?: string }>;
  containers: Array<{ type: string; id: string; title: string; subtitle?: string; href?: string }>;
  storage: Array<{ type: string; id: string; title: string; subtitle?: string; href?: string }>;
};

export function CommandSearch({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const [q, setQ] = useState("");
  const router = useRouter();
  const { data } = useQuery({
    queryKey: ["search", q],
    queryFn: () => api<SearchResponse>(`/api/search?q=${encodeURIComponent(q)}`),
    enabled: open && q.length > 0,
  });

  const groups = [
    { label: "Hosts", items: data?.hosts ?? [] },
    { label: "VMs", items: data?.vms ?? [] },
    { label: "Container", items: data?.containers ?? [] },
    { label: "Storage", items: data?.storage ?? [] },
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
          <DialogTitle className="proxora-section text-xs">Suchen</DialogTitle>
        </DialogHeader>
        <div className="p-4 pt-2">
          <Input autoFocus placeholder="Suchen: VM, Host, Storage…" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="mt-3 max-h-80 overflow-y-auto">
            {groups.map((g) =>
              g.items.length ? (
                <div key={g.label} className="mb-3">
                  <p className="mb-1 text-[11px] font-semibold uppercase text-muted-foreground">{g.label}</p>
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
              <p className="py-8 text-center text-sm text-muted-foreground">Keine Treffer</p>
            ) : null}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
