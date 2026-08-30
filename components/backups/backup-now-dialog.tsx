"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ProxmoxTaskProgress } from "@/components/backups/task-progress";
import { useBackupTask } from "@/components/backups/use-backup-task";
import { api } from "@/lib/api";
import { useI18n } from "@/components/i18n/locale-provider";
import { SELECT_CLASS } from "@/components/backups/types";

export function BackupNowDialog({
  hostId,
  node,
  vmid,
  kind,
  storages,
  onDone,
}: {
  hostId: string;
  node: string;
  vmid: number;
  kind: "vm" | "lxc";
  storages: string[];
  onDone?: () => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [storage, setStorage] = useState(storages[0] ?? "");
  const [mode, setMode] = useState("snapshot");
  const [busy, setBusy] = useState(false);
  const [upid, setUpid] = useState<string | null>(null);
  const toastedRef = useRef(false);

  useEffect(() => {
    if (storages[0] && !storage) setStorage(storages[0]);
  }, [storages, storage]);

  const { logLines, finished, errorMsg } = useBackupTask({
    hostId,
    node,
    upid,
    open,
    failedFallback: t("backup.failed"),
  });
  const showProgress = busy || Boolean(upid);
  const locked = showProgress && !finished && !errorMsg;

  useEffect(() => {
    toastedRef.current = false;
  }, [upid]);

  useEffect(() => {
    if (!open || toastedRef.current || (!finished && !errorMsg)) return;
    toastedRef.current = true;
    setBusy(false);
    if (finished) {
      toast.success(t("backup.done"));
      onDone?.();
    } else if (errorMsg) {
      toast.error(errorMsg);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finished, errorMsg, open]);

  useEffect(() => {
    if (!finished) return;
    const timer = window.setTimeout(() => resetAndClose(), 800);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finished]);

  function resetAndClose() {
    setBusy(false);
    setUpid(null);
    setOpen(false);
  }

  async function submit() {
    setBusy(true);
    setUpid(null);
    toastedRef.current = false;
    try {
      const res = await api<{ upid?: string }>(`/api/hosts/${hostId}/backups`, {
        method: "POST",
        body: JSON.stringify({ action: "run", node, vmid: String(vmid), storage, mode, compress: "zstd" }),
      });
      if (!res.upid) throw new Error(t("common.failed"));
      setUpid(res.upid);
    } catch (e) {
      setBusy(false);
      toast.error(e instanceof Error ? e.message : t("common.failed"));
    }
  }

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        {t("backup.now")}
      </Button>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next && locked) return;
          if (!next) {
            setBusy(false);
            setUpid(null);
          }
          setOpen(next);
        }}
      >
        <DialogContent className={showProgress ? "max-w-2xl" : undefined}>
          <DialogHeader>
            <DialogTitle>{t("backup.nowTitle", { kind: kind.toUpperCase(), id: vmid })}</DialogTitle>
            <DialogDescription>
              {showProgress
                ? finished
                  ? t("backup.done")
                  : errorMsg
                    ? t("backup.failed")
                    : upid
                      ? t("backup.working")
                      : t("backup.starting")
                : t("backup.description")}
            </DialogDescription>
          </DialogHeader>
          {showProgress ? (
            <div className="grid gap-3">
              {errorMsg ? <p className="text-sm text-danger">{errorMsg}</p> : null}
              <ProxmoxTaskProgress
                lines={logLines}
                running={!finished && !errorMsg}
                fallbackDetail={upid ? t("backup.working") : t("backup.starting")}
              />
              <div className="flex justify-end">
                <Button variant="outline" onClick={resetAndClose} disabled={locked}>
                  {finished || errorMsg ? t("common.close") : t("common.cancel")}
                </Button>
              </div>
            </div>
          ) : (
            <div className="grid gap-3">
              <label className="text-sm">
                {t("backup.storage")}
                <select className={SELECT_CLASS} value={storage} onChange={(e) => setStorage(e.target.value)}>
                  {storages.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm">
                {t("backup.mode")}
                <select className={SELECT_CLASS} value={mode} onChange={(e) => setMode(e.target.value)}>
                  <option value="snapshot">{t("backup.mode.snapshot")}</option>
                  <option value="suspend">{t("backup.mode.suspend")}</option>
                  <option value="stop">{t("backup.mode.stop")}</option>
                </select>
              </label>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setOpen(false)}>
                  {t("common.cancel")}
                </Button>
                <Button onClick={() => void submit()} disabled={!storage}>
                  {t("backup.runNow")}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
