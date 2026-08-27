"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api } from "@/lib/api";
import { useI18n } from "@/components/i18n/locale-provider";
import { SELECT_CLASS } from "@/components/backups/types";

export function BackupNowDialog({
  hostId,
  node,
  vmid,
  kind,
  storages,
}: {
  hostId: string;
  node: string;
  vmid: number;
  kind: "vm" | "lxc";
  storages: string[];
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [storage, setStorage] = useState(storages[0] ?? "");
  const [mode, setMode] = useState("snapshot");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (storages[0] && !storage) setStorage(storages[0]);
  }, [storages, storage]);

  async function submit() {
    setBusy(true);
    try {
      await api(`/api/hosts/${hostId}/backups`, {
        method: "POST",
        body: JSON.stringify({ action: "run", node, vmid: String(vmid), storage, mode, compress: "zstd" }),
      });
      toast.success(t("backup.started"));
      setOpen(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        {t("backup.now")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("backup.nowTitle", { kind: kind.toUpperCase(), id: vmid })}</DialogTitle>
            <DialogDescription>{t("backup.description")}</DialogDescription>
          </DialogHeader>
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
              <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>
                {t("common.cancel")}
              </Button>
              <Button onClick={() => void submit()} disabled={busy || !storage}>
                {t("backup.runNow")}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
