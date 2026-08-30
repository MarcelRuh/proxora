"use client";

import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ProxmoxTaskProgress } from "@/components/backups/task-progress";
import { useBackupTask } from "@/components/backups/use-backup-task";
import { useI18n } from "@/components/i18n/locale-provider";

export function BackupTaskDialog({
  hostId,
  node,
  upid,
  open,
  title,
  onOpenChange,
  onDone,
}: {
  hostId: string;
  node: string;
  upid: string | null;
  open: boolean;
  title: string;
  onOpenChange: (open: boolean) => void;
  onDone?: () => void;
}) {
  const { t } = useI18n();
  const { logLines, finished, errorMsg, tracking } = useBackupTask({
    hostId,
    node,
    upid,
    open,
    failedFallback: t("backup.failed"),
  });
  const toastedRef = useRef(false);
  const locked = Boolean(upid) && !finished && !errorMsg;

  useEffect(() => {
    toastedRef.current = false;
  }, [upid]);

  useEffect(() => {
    if (!open || toastedRef.current || (!finished && !errorMsg)) return;
    toastedRef.current = true;
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
    const timer = window.setTimeout(() => onOpenChange(false), 800);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finished]);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && locked) return;
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {finished ? t("backup.done") : errorMsg ? t("backup.failed") : tracking ? t("backup.working") : t("backup.starting")}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          {errorMsg ? <p className="text-sm text-danger">{errorMsg}</p> : null}
          <ProxmoxTaskProgress
            lines={logLines}
            running={!finished && !errorMsg}
            fallbackDetail={upid ? t("backup.working") : t("backup.starting")}
          />
          <div className="flex justify-end">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={locked}>
              {finished || errorMsg ? t("common.close") : t("common.cancel")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
