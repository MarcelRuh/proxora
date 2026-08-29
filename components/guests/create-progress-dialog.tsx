"use client";

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ProxmoxTaskProgress } from "@/components/backups/task-progress";
import { useI18n } from "@/components/i18n/locale-provider";

export function CreateProgressDialog({
  open,
  locked,
  finished,
  error,
  title,
  detail,
  onClose,
}: {
  open: boolean;
  locked: boolean;
  finished: boolean;
  error: string | null;
  title: string;
  detail?: string;
  onClose: () => void;
}) {
  const { t } = useI18n();
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && locked) return;
        if (!next) onClose();
      }}
    >
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {finished ? t("create.progressDone") : error ? t("common.failed") : detail}
          </DialogDescription>
        </DialogHeader>
        {error ? <p className="text-sm text-danger">{error}</p> : null}
        <ProxmoxTaskProgress lines={[]} running={!finished && !error} fallbackDetail={detail ?? title} />
        <div className="flex justify-end">
          <Button variant="outline" onClick={onClose} disabled={locked}>
            {finished || error ? t("common.close") : t("common.cancel")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
