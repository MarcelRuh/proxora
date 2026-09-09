"use client";

import { useMemo, useState, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/input";
import { ProxmoxTaskProgress } from "@/components/backups/task-progress";
import { api } from "@/lib/api";
import { isUpid } from "@/lib/guest-task";
import { migrateTargetNodes } from "@/lib/guest-migrate";
import { useI18n } from "@/components/i18n/locale-provider";
import { useProxmoxTask } from "@/components/tasks/use-proxmox-task";

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
  disabled,
  disabledReason,
  onDone,
}: {
  kind: "vm" | "lxc";
  hostId: string;
  node: string;
  vmid: number;
  path: string;
  running: boolean;
  disabled?: boolean;
  disabledReason?: string;
  onDone: (target: string) => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [target, setTarget] = useState("");
  const [upid, setUpid] = useState<string | null>(null);
  const [startedTarget, setStartedTarget] = useState("");
  const toastedRef = useRef(false);
  const { data, isLoading, error } = useQuery({
    queryKey: ["host", hostId],
    queryFn: () => api<HostStatus>(`/api/hosts/${hostId}/status`),
    enabled: open,
    staleTime: 20_000,
  });
  const targets = useMemo(() => migrateTargetNodes(data?.nodes ?? [], node), [data?.nodes, node]);
  const selected = targets.includes(target) ? target : (targets[0] ?? "");

  const tracking = Boolean(upid);
  const { logLines, finished, errorMsg } = useProxmoxTask({
    hostId,
    node,
    upid,
    open: open && tracking,
    failedFallback: t("common.failed"),
  });
  const locked = tracking && !finished && !errorMsg;

  useEffect(() => {
    toastedRef.current = false;
  }, [upid]);

  useEffect(() => {
    if (!open || toastedRef.current || (!finished && !errorMsg)) return;
    toastedRef.current = true;
    if (errorMsg) {
      toast.error(errorMsg);
      return;
    }
    toast.success(t("guest.migrated"));
    const dest = startedTarget || selected;
    const timer = window.setTimeout(() => {
      setOpen(false);
      setBusy(false);
      setUpid(null);
      onDone(dest);
    }, 800);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finished, errorMsg, open]);

  async function submit() {
    if (!selected) return;
    setBusy(true);
    try {
      const res = await api<{ upid?: unknown }>(path, {
        method: "POST",
        body: JSON.stringify({ action: "migrate", target: selected, wait: false }),
      });
      const next = isUpid(res.upid) ? res.upid : null;
      if (!next) {
        toast.success(t("guest.migrated"));
        setOpen(false);
        onDone(selected);
        setBusy(false);
        return;
      }
      setStartedTarget(selected);
      setUpid(next);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.failed"));
      setBusy(false);
    }
  }

  return (
    <>
      <Button variant="outline" disabled={disabled} title={disabled ? disabledReason : undefined} onClick={() => setOpen(true)}>
        {t("guest.migrate")}
      </Button>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (locked) return;
          setOpen(next);
          if (!next) {
            setBusy(false);
            setUpid(null);
          }
        }}
      >
        <DialogContent className={tracking ? "max-w-2xl" : undefined}>
          <DialogHeader>
            <DialogTitle>
              {tracking ? t("guest.migrateProgress") : t("guest.migrateTitle", { kind: kind.toUpperCase(), id: vmid })}
            </DialogTitle>
            <DialogDescription>
              {tracking
                ? errorMsg
                  ? t("common.failed")
                  : finished
                    ? t("create.progressDone")
                    : t("guest.migrateWorking")
                : running
                  ? t("guest.migrateBodyOnline")
                  : t("guest.migrateBodyOffline")}
            </DialogDescription>
          </DialogHeader>
          {tracking ? (
            <div className="grid gap-3">
              {errorMsg ? <p className="text-sm text-danger">{errorMsg}</p> : null}
              <ProxmoxTaskProgress
                lines={logLines}
                running={!finished && !errorMsg}
                fallbackDetail={t("guest.migrateWorking")}
              />
              <div className="flex justify-end">
                <Button
                  variant="outline"
                  onClick={() => {
                    setOpen(false);
                    setBusy(false);
                    setUpid(null);
                  }}
                  disabled={locked}
                >
                  {finished || errorMsg ? t("common.close") : t("common.cancel")}
                </Button>
              </div>
            </div>
          ) : (
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
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
