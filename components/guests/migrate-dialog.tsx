"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/input";
import { api } from "@/lib/api";
import { migrateTargetNodes } from "@/lib/guest-migrate";
import { useI18n } from "@/components/i18n/locale-provider";

type HostStatus = {
  nodes: Array<{ node: string; online: string }>;
};

const selectClass = "mt-1 h-9 w-full rounded-[4px] border border-input bg-white/[0.03] px-2 text-sm";

export function MigrateDialog({
  kind,
  hostId,
  node,
  vmid,
  path,
  running,
  onDone,
}: {
  kind: "vm" | "lxc";
  hostId: string;
  node: string;
  vmid: number;
  path: string;
  running: boolean;
  onDone: (target: string) => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [target, setTarget] = useState("");
  const { data, isLoading, error } = useQuery({
    queryKey: ["host", hostId],
    queryFn: () => api<HostStatus>(`/api/hosts/${hostId}/status`),
    enabled: open,
    staleTime: 20_000,
  });
  const targets = useMemo(() => migrateTargetNodes(data?.nodes ?? [], node), [data?.nodes, node]);
  const selected = targets.includes(target) ? target : (targets[0] ?? "");

  async function submit() {
    if (!selected) return;
    setBusy(true);
    try {
      await api(path, { method: "POST", body: JSON.stringify({ action: "migrate", target: selected }) });
      toast.success(t("guest.migrated"));
      setOpen(false);
      onDone(selected);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        {t("guest.migrate")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("guest.migrateTitle", { kind: kind.toUpperCase(), id: vmid })}</DialogTitle>
            <DialogDescription>
              {running ? t("guest.migrateBodyOnline") : t("guest.migrateBodyOffline")}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            {error ? (
              <p className="text-sm text-destructive">{error instanceof Error ? error.message : t("common.failed")}</p>
            ) : isLoading ? (
              <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
            ) : targets.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("guest.migrateNoTarget")}</p>
            ) : (
              <div className="space-y-1">
                <Label>{t("guest.migrateTarget")}</Label>
                <select className={selectClass} value={selected} onChange={(e) => setTarget(e.target.value)}>
                  {targets.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>
                {t("common.cancel")}
              </Button>
              <Button onClick={() => void submit()} disabled={busy || !selected}>
                {t("guest.migrateAction")}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
