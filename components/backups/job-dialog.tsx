"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input, Label } from "@/components/ui/input";
import { api } from "@/lib/api";
import { useI18n } from "@/components/i18n/locale-provider";
import { SELECT_CLASS, type BackupJob, type BackupOverview } from "@/components/backups/types";
import {
  BACKUP_DAYS,
  formatBackupSchedule,
  parseBackupSchedule,
  type BackupDay,
} from "@/lib/backup";
import { cn } from "@/lib/utils";
import type { MessageKey } from "@/lib/i18n/messages";

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

const WEEKDAYS: BackupDay[] = ["mon", "tue", "wed", "thu", "fri"];
const WEEKEND: BackupDay[] = ["sat", "sun"];

function dayKey(day: BackupDay): MessageKey {
  return `backup.day.${day}` as MessageKey;
}

function selectedIds(vmid: string): string[] {
  return vmid.split(",").map((s) => s.trim()).filter(Boolean);
}

function fromJob(job: BackupJob | null, overview: BackupOverview): Form {
  return {
    enabled: job?.enabled ?? true,
    schedule: job?.schedule || "02:00",
    storage: job?.storage || overview.backupStorages[0] || "",
    mode: (job?.mode as Form["mode"]) || "snapshot",
    compress: job?.compress || "zstd",
    all: job?.all ?? false,
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
  const parsed = useMemo(() => parseBackupSchedule(form.schedule), [form.schedule]);
  const ids = useMemo(() => selectedIds(form.vmid), [form.vmid]);
  const canSave = Boolean(form.storage && parsed.days.length && (form.all || ids.length));

  useEffect(() => {
    if (open) setForm(fromJob(job, overview));
    // Reset only when the dialog opens or the job changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, job?.id]);

  function setDays(days: BackupDay[]) {
    setForm({ ...form, schedule: formatBackupSchedule(days, parsed.time) });
  }

  function toggleDay(day: BackupDay) {
    const next = parsed.days.includes(day) ? parsed.days.filter((item) => item !== day) : [...parsed.days, day];
    if (next.length === 0) return;
    setDays(next);
  }

  function toggleGuest(id: string, checked: boolean) {
    const current = selectedIds(form.vmid);
    const next = checked ? [...current, id] : current.filter((v) => v !== id);
    setForm({ ...form, all: false, vmid: [...new Set(next)].join(",") });
  }

  async function submit() {
    if (!canSave) {
      toast.error(t("backup.needGuests"));
      return;
    }
    setBusy(true);
    try {
      await api(`/api/hosts/${hostId}/backups`, {
        method: "POST",
        body: JSON.stringify({
          action: job ? "update-job" : "create-job",
          id: job?.id,
          enabled: form.enabled,
          schedule: formatBackupSchedule(parsed.days, parsed.time),
          storage: form.storage,
          mode: form.mode,
          compress: form.compress,
          all: form.all,
          vmid: form.all ? undefined : ids.join(","),
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
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{job ? t("backup.editJob") : t("backup.addJob")}</DialogTitle>
          <DialogDescription>{t("backup.jobHint")}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} />
            {t("settings.enabled")}
          </label>

          <div className="space-y-2">
            <Label>{t("backup.schedule")}</Label>
            <div className="flex flex-wrap gap-1">
              {BACKUP_DAYS.map((day) => (
                <button
                  key={day}
                  type="button"
                  onClick={() => toggleDay(day)}
                  className={cn(
                    "h-8 min-w-9 rounded-[4px] border px-2 text-xs font-semibold uppercase",
                    parsed.days.includes(day)
                      ? "border-primary bg-primary/15 text-foreground"
                      : "border-border text-muted-foreground hover:border-primary/50",
                  )}
                >
                  {t(dayKey(day))}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap gap-1">
              <Button type="button" size="sm" variant="outline" onClick={() => setDays([...BACKUP_DAYS])}>
                {t("backup.presetDaily")}
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={() => setDays(WEEKDAYS)}>
                {t("backup.presetWeekdays")}
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={() => setDays(WEEKEND)}>
                {t("backup.presetWeekend")}
              </Button>
            </div>
            <div className="space-y-1">
              <Label>{t("backup.scheduleTime")}</Label>
              <Input
                type="time"
                value={parsed.time}
                onChange={(e) => setForm({ ...form, schedule: formatBackupSchedule(parsed.days, e.target.value || parsed.time) })}
              />
            </div>
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
                <option value="">{t("backup.allNodes")}</option>
                {overview.nodes.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Label>{t("backup.guests")}</Label>
              <div className="flex flex-wrap gap-1">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    setForm({
                      ...form,
                      all: false,
                      vmid: overview.guests.map((guest) => String(guest.vmid)).join(","),
                    })
                  }
                >
                  {t("backup.selectListed")}
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={() => setForm({ ...form, all: false, vmid: "" })}>
                  {t("settings.selectNone")}
                </Button>
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.all}
                onChange={(e) =>
                  setForm({
                    ...form,
                    all: e.target.checked,
                    vmid: e.target.checked ? "" : form.vmid,
                  })
                }
              />
              {t("backup.allGuests")}
            </label>
            <p className="text-xs text-muted-foreground">{t("backup.guestsHint")}</p>
            <div className="max-h-56 space-y-1 overflow-y-auto rounded-[4px] border border-border p-2">
              {overview.guests.length === 0 ? (
                <Input
                  value={form.vmid}
                  disabled={form.all}
                  onChange={(e) => setForm({ ...form, all: false, vmid: e.target.value })}
                  placeholder="100,101"
                />
              ) : (
                overview.guests.map((guest) => {
                  const id = String(guest.vmid);
                  const selected = form.all || ids.includes(id);
                  return (
                    <label key={`${guest.kind}-${guest.vmid}`} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={selected}
                        disabled={form.all}
                        onChange={(e) => toggleGuest(id, e.target.checked)}
                      />
                      <span className="min-w-0 flex-1 truncate">
                        {guest.vmid} {guest.name}
                      </span>
                      <span className="text-[10px] uppercase text-muted-foreground">{guest.kind}</span>
                    </label>
                  );
                })
              )}
            </div>
          </div>

          <div className="space-y-1">
            <Label>{t("backup.keepLast")}</Label>
            <Input value={form.keepLast} onChange={(e) => setForm({ ...form, keepLast: e.target.value })} />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
              {t("common.cancel")}
            </Button>
            <Button onClick={() => void submit()} disabled={busy || !canSave}>
              {t("common.save")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
