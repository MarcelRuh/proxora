"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input, Label } from "@/components/ui/input";
import { api } from "@/lib/api";
import { useI18n } from "@/components/i18n/locale-provider";
import { SELECT_CLASS, type BackupJob, type BackupOverview } from "@/components/backups/types";

type Form = {
  enabled: boolean;
  schedule: string;
  storage: string;
  mode: "snapshot" | "suspend" | "stop";
  compress: string;
  all: boolean;
  vmid: string;
  node: string;
  keepLast: string;
};

function fromJob(job: BackupJob | null, overview: BackupOverview): Form {
  return {
    enabled: job?.enabled ?? true,
    schedule: job?.schedule || "02:00",
    storage: job?.storage || overview.backupStorages[0] || "",
    mode: (job?.mode as Form["mode"]) || "snapshot",
    compress: job?.compress || "zstd",
    all: job ? job.all || !job.vmid : true,
    vmid: job?.vmid ?? "",
    node: job?.node ?? "",
    keepLast: job?.keepLast != null ? String(job.keepLast) : "7",
  };
}

export function JobDialog({
  hostId,
  overview,
  job,
  open,
  onOpenChange,
  onDone,
}: {
  hostId: string;
  overview: BackupOverview;
  job: BackupJob | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const [form, setForm] = useState<Form>(() => fromJob(job, overview));
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) setForm(fromJob(job, overview));
    // Reset only when the dialog opens or the job changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, job?.id]);

  async function submit() {
    setBusy(true);
    try {
      await api(`/api/hosts/${hostId}/backups`, {
        method: "POST",
        body: JSON.stringify({
          action: job ? "update-job" : "create-job",
          id: job?.id,
          enabled: form.enabled,
          schedule: form.schedule.trim(),
          storage: form.storage,
          mode: form.mode,
          compress: form.compress,
          all: form.all,
          vmid: form.all ? undefined : form.vmid.trim(),
          node: form.node || undefined,
          keepLast: form.keepLast ? Number(form.keepLast) : null,
        }),
      });
      toast.success(t("backup.jobSaved"));
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
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{job ? t("backup.editJob") : t("backup.addJob")}</DialogTitle>
          <DialogDescription>{t("backup.description")}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} />
            {t("settings.enabled")}
          </label>
          <div className="space-y-1">
            <Label>{t("backup.schedule")}</Label>
            <Input value={form.schedule} onChange={(e) => setForm({ ...form, schedule: e.target.value })} placeholder="02:00" />
          </div>
          <label className="text-sm">
            {t("backup.storage")}
            <select className={SELECT_CLASS} value={form.storage} onChange={(e) => setForm({ ...form, storage: e.target.value })}>
              {(overview.backupStorages.length ? overview.backupStorages : [form.storage].filter(Boolean)).map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm">
              {t("backup.mode")}
              <select className={SELECT_CLASS} value={form.mode} onChange={(e) => setForm({ ...form, mode: e.target.value as Form["mode"] })}>
                <option value="snapshot">{t("backup.mode.snapshot")}</option>
                <option value="suspend">{t("backup.mode.suspend")}</option>
                <option value="stop">{t("backup.mode.stop")}</option>
              </select>
            </label>
            <label className="text-sm">
              {t("backup.compress")}
              <select className={SELECT_CLASS} value={form.compress} onChange={(e) => setForm({ ...form, compress: e.target.value })}>
                <option value="zstd">zstd</option>
                <option value="lzo">lzo</option>
                <option value="gzip">gzip</option>
                <option value="0">none</option>
              </select>
            </label>
          </div>
          {(overview.nodes.length ?? 0) > 1 ? (
            <label className="text-sm">
              {t("backup.node")}
              <select className={SELECT_CLASS} value={form.node} onChange={(e) => setForm({ ...form, node: e.target.value })}>
                <option value="">{t("backup.allGuests")}</option>
                {overview.nodes.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.all} onChange={(e) => setForm({ ...form, all: e.target.checked })} />
            {t("backup.allGuests")}
          </label>
          {form.all ? null : (
            <div className="max-h-48 space-y-1 overflow-y-auto rounded-[4px] border border-border p-2">
              {overview.guests.length === 0 ? (
                <Input value={form.vmid} onChange={(e) => setForm({ ...form, vmid: e.target.value })} placeholder="100,101" />
              ) : (
                overview.guests.map((guest) => {
                  const id = String(guest.vmid);
                  const selected = form.vmid.split(",").map((s) => s.trim()).filter(Boolean).includes(id);
                  return (
                    <label key={`${guest.kind}-${guest.vmid}`} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={(e) => {
                          const current = form.vmid.split(",").map((s) => s.trim()).filter(Boolean);
                          const next = e.target.checked ? [...current, id] : current.filter((v) => v !== id);
                          setForm({ ...form, vmid: [...new Set(next)].join(",") });
                        }}
                      />
                      {guest.vmid} {guest.name}
                      <span className="text-[10px] uppercase text-muted-foreground">{guest.kind}</span>
                    </label>
                  );
                })
              )}
            </div>
          )}
          <div className="space-y-1">
            <Label>{t("backup.keepLast")}</Label>
            <Input value={form.keepLast} onChange={(e) => setForm({ ...form, keepLast: e.target.value })} />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
              {t("common.cancel")}
            </Button>
            <Button onClick={() => void submit()} disabled={busy || !form.storage || !form.schedule.trim() || (!form.all && !form.vmid.trim())}>
              {t("common.save")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
