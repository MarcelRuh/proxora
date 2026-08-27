"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input, Label } from "@/components/ui/input";
import { api } from "@/lib/api";
import { useI18n } from "@/components/i18n/locale-provider";
import { SELECT_CLASS, type BackupFile, type BackupOverview } from "@/components/backups/types";

export function RestoreDialog({
  hostId,
  overview,
  file,
  open,
  onOpenChange,
  onDone,
}: {
  hostId: string;
  overview: BackupOverview;
  file: BackupFile | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const [vmid, setVmid] = useState("");
  const [node, setNode] = useState("");
  const [storage, setStorage] = useState("");
  const [force, setForce] = useState(true);
  const [startAfter, setStartAfter] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open || !file) return;
    setVmid(String(file.vmid ?? ""));
    setNode(file.node || overview.primaryNode || overview.nodes[0] || "");
    setStorage(overview.diskStorages[0] || "");
    setForce(true);
    setStartAfter(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, file?.volid]);

  async function submit() {
    if (!file) return;
    setBusy(true);
    try {
      await api(`/api/hosts/${hostId}/backups`, {
        method: "POST",
        body: JSON.stringify({
          action: "restore",
          node,
          volid: file.volid,
          vmid: Number(vmid),
          storage,
          force,
          startAfter,
        }),
      });
      toast.success(t("backup.restored"));
      onOpenChange(false);
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("backup.restoreTitle")}</DialogTitle>
          <DialogDescription>{t("backup.restoreBody")}</DialogDescription>
        </DialogHeader>
        <p className="break-all text-xs text-muted-foreground">{file?.volid}</p>
        <div className="mt-3 grid gap-3">
          <div className="space-y-1">
            <Label>{t("create.id")}</Label>
            <Input value={vmid} onChange={(e) => setVmid(e.target.value)} />
          </div>
          <label className="text-sm">
            {t("backup.node")}
            <select className={SELECT_CLASS} value={node} onChange={(e) => setNode(e.target.value)}>
              {overview.nodes.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            {t("backup.targetStorage")}
            <select className={SELECT_CLASS} value={storage} onChange={(e) => setStorage(e.target.value)}>
              {overview.diskStorages.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} />
            {t("backup.force")}
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={startAfter} onChange={(e) => setStartAfter(e.target.checked)} />
            {t("backup.startAfter")}
          </label>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
              {t("common.cancel")}
            </Button>
            <Button onClick={() => void submit()} disabled={busy || !Number(vmid) || !node || !storage}>
              {t("backup.restoreAction")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
