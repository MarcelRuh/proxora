"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api } from "@/lib/api";
import { backupsForGuest, parseBackupVolid } from "@/lib/backup";
import { bytesToSize } from "@/lib/utils";
import { useCan } from "@/components/auth/session-user";
import { useI18n } from "@/components/i18n/locale-provider";
import type { BackupFile } from "@/components/backups/types";

export function GuestDeleteDialog({
  hostId,
  kind,
  vmid,
  name,
  kindLabel,
  disabled,
  onConfirm,
  children,
}: {
  hostId: string;
  kind: "vm" | "lxc";
  vmid: number;
  name: string;
  kindLabel: string;
  disabled?: boolean;
  onConfirm: (backupVolids: string[]) => Promise<void>;
  children: React.ReactNode;
}) {
  const { t, locale } = useI18n();
  const canViewBackups = useCan("backup.view", hostId);
  const canDeleteBackups = useCan("backup.delete", hostId);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

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

  function toggle(volid: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(volid)) next.delete(volid);
      else next.add(volid);
      return next;
    });
  }

  return (
    <>
      <span
        onClick={() => {
          if (!busy && !disabled) {
            setSelected(new Set());
            setOpen(true);
          }
        }}
      >
        {children}
      </span>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (busy) return;
          setOpen(next);
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("guest.deleteShutdownTitle")}</DialogTitle>
            <DialogDescription>
              {t("guest.deleteShutdownBody", { kind: kindLabel, id: vmid, name })}
            </DialogDescription>
          </DialogHeader>

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
                <ul className="max-h-48 space-y-1 overflow-y-auto rounded-md border border-border p-2">
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
                setBusy(true);
                void onConfirm([...selected])
                  .then(() => setOpen(false))
                  .catch((err: unknown) => {
                    toast.error(err instanceof Error ? err.message : t("common.failed"));
                  })
                  .finally(() => setBusy(false));
              }}
            >
              {busy ? t("guest.deleteWorking") : t("guest.deleteConfirm")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
