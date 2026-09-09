"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ProxmoxTaskProgress } from "@/components/backups/task-progress";
import { api } from "@/lib/api";
import { backupsForGuest, parseBackupVolid } from "@/lib/backup";
import { isUpid } from "@/lib/guest-task";
import { bytesToSize } from "@/lib/utils";
import { useCan } from "@/components/auth/session-user";
import { useI18n } from "@/components/i18n/locale-provider";
import { useProxmoxTask } from "@/components/tasks/use-proxmox-task";
import type { BackupFile } from "@/components/backups/types";

type DeletePhase = "shutdown" | "stop" | "delete";

export function GuestDeleteDialog({
  hostId,
  node,
  kind,
  vmid,
  name,
  kindLabel,
  disabled,
  onConfirm,
  onFinished,
  children,
}: {
  hostId: string;
  node: string;
  kind: "vm" | "lxc";
  vmid: number;
  name: string;
  kindLabel: string;
  disabled?: boolean;
  onConfirm: (
    backupVolids: string[],
    phase?: DeletePhase,
  ) => Promise<{ upid?: unknown; phase?: DeletePhase }>;
  onFinished?: () => void;
  children: React.ReactNode;
}) {
  const { t, locale } = useI18n();
  const canViewBackups = useCan("backup.view", hostId);
  const canDeleteBackups = useCan("backup.delete", hostId);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [upid, setUpid] = useState<string | null>(null);
  const [phase, setPhase] = useState<DeletePhase>("delete");
  const [pendingVolids, setPendingVolids] = useState<string[]>([]);
  const handledUpidRef = useRef<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["backup-files", hostId],
    queryFn: () => api<{ files: BackupFile[] }>(`/api/hosts/${hostId}/backups/files`),
    enabled: open && canViewBackups,
    staleTime: 30_000,
  });

  const files = useMemo(
    () => backupsForGuest(data?.files ?? [], vmid, kind),
    [data?.files, vmid, kind],
  );
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
    if (!upid || errorMsg || !finished) return;
    if (handledUpidRef.current === upid) return;
    handledUpidRef.current = upid;
    if (phase === "shutdown") {
      void runPhase("delete", pendingVolids);
      return;
    }
    if (phase === "stop") {
      void runPhase("stop", pendingVolids);
      return;
    }
    toast.success(t("guest.deleted", { kind: kindLabel, id: vmid }));
    onFinished?.();
    setOpen(false);
    resetTask();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finished, errorMsg, upid, phase]);

  function resetTask() {
    setBusy(false);
    setUpid(null);
    setPendingVolids([]);
    handledUpidRef.current = null;
  }

  function toggle(volid: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(volid)) next.delete(volid);
      else next.add(volid);
      return next;
    });
  }

  async function runPhase(nextPhase: DeletePhase | undefined, backupVolids: string[]) {
    setBusy(true);
    try {
      const res = await onConfirm(backupVolids, nextPhase);
      const nextUpid = isUpid(res.upid) ? res.upid : null;
      if (!nextUpid) {
        toast.success(t("guest.deleted", { kind: kindLabel, id: vmid }));
        onFinished?.();
        setOpen(false);
        resetTask();
        return;
      }
      setPhase(res.phase ?? nextPhase ?? "delete");
      setUpid(nextUpid);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : t("common.failed"));
      setBusy(false);
    }
  }

  const progressTitle =
    phase === "shutdown"
      ? t("guest.deleteShutdownProgress")
      : phase === "stop"
        ? t("guest.deleteStopProgress")
        : t("guest.deleteProgress");

  return (
    <>
      <span
        onClick={() => {
          if (!busy && !disabled) {
            setSelected(new Set());
            resetTask();
            setOpen(true);
          }
        }}
      >
        {children}
      </span>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (locked) return;
          setOpen(next);
        }}
      >
        <DialogContent className={tracking ? "max-w-2xl" : "max-w-lg"}>
          <DialogHeader>
            <DialogTitle>{tracking ? progressTitle : t("guest.deleteShutdownTitle")}</DialogTitle>
            <DialogDescription>
              {tracking
                ? errorMsg
                  ? t("common.failed")
                  : finished
                    ? t("create.progressDone")
                    : t("guest.deleteWorking")
                : t("guest.deleteShutdownBody", { kind: kindLabel, id: vmid, name })}
            </DialogDescription>
          </DialogHeader>

          {tracking ? (
            <div className="grid gap-3">
              {errorMsg ? <p className="text-sm text-danger">{errorMsg}</p> : null}
              <ProxmoxTaskProgress
                lines={logLines}
                running={!finished && !errorMsg}
                fallbackDetail={t("guest.deleteWorking")}
              />
              <div className="flex justify-end">
                <Button
                  variant="outline"
                  onClick={() => {
                    setOpen(false);
                    resetTask();
                  }}
                  disabled={locked}
                >
                  {finished || errorMsg ? t("common.close") : t("common.cancel")}
                </Button>
              </div>
            </div>
          ) : (
            <>
              {canViewBackups && canDeleteBackups ? (
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium">{t("guest.deleteBackups")}</p>
                    {files.length ? (
                      <div className="flex gap-2">
                        <Button type="button" size="sm" variant="ghost" onClick={() => setSelected(new Set(files.map((f) => f.volid)))}>
                          {t("table.selectAll")}
                        </Button>
                        <Button type="button" size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
                          {t("common.none")}
                        </Button>
                      </div>
                    ) : null}
                  </div>
                  <p className="text-xs text-muted-foreground">{t("guest.deleteBackupsHint")}</p>
                  {isLoading ? (
                    <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
                  ) : files.length === 0 ? (
                    <p className="text-sm text-muted-foreground">{t("guest.deleteBackupsNone")}</p>
                  ) : (
                    <ul className="max-h-48 space-y-1 overflow-auto rounded-md border border-border p-2">
                      {files.map((file) => {
                        const parsed = parseBackupVolid(file.volid);
                        const when = file.ctime
                          ? new Date(file.ctime).toLocaleString(locale === "en" ? "en-GB" : "de-DE")
                          : "—";
                        return (
                          <li key={file.volid}>
                            <label className="flex cursor-pointer items-start gap-2 rounded-md px-1 py-1 text-sm hover:bg-white/[0.04]">
                              <input
                                type="checkbox"
                                className="mt-1"
                                checked={selected.has(file.volid)}
                                onChange={() => toggle(file.volid)}
                                disabled={busy}
                              />
                              <span className="min-w-0">
                                <span className="block truncate font-mono text-xs">{parsed.filename}</span>
                                <span className="text-xs text-muted-foreground">
                                  {when} · {bytesToSize(file.size)} · {file.storage}
                                </span>
                              </span>
                            </label>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              ) : null}

              <div className="mt-4 flex justify-end gap-2">
                <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>
                  {t("common.cancel")}
                </Button>
                <Button
                  variant="destructive"
                  disabled={busy}
                  onClick={() => {
                    const volids = [...selected];
                    setPendingVolids(volids);
                    void runPhase(undefined, volids);
                  }}
                >
                  {t("guest.deleteConfirm")}
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
