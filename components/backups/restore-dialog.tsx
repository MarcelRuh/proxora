"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input, Label } from "@/components/ui/input";
import { ProxmoxTaskProgress } from "@/components/backups/task-progress";
import { api } from "@/lib/api";
import { backupsForGuestNewestFirst, guestNeedsStopForRestore, normalizeProxmoxTaskLog, parseBackupVolid } from "@/lib/backup";
import { isFailedTaskExit } from "@/lib/backup-tasks";
import { bytesToSize } from "@/lib/utils";
import { useI18n } from "@/components/i18n/locale-provider";
import { SELECT_CLASS, type BackupFile, type BackupOverview } from "@/components/backups/types";

type TaskPayload = {
  status: { status?: string; exitstatus?: string };
  log: Array<{ n: number; t: string }>;
};

export function RestoreDialog({
  hostId,
  overview: overviewProp,
  file: fileProp,
  pickFor,
  open,
  onOpenChange,
  onDone,
}: {
  hostId: string;
  overview?: BackupOverview;
  file?: BackupFile | null;
  pickFor?: { vmid: number; kind: "vm" | "lxc" };
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}) {
  const { t, locale } = useI18n();
  const [vmid, setVmid] = useState("");
  const [node, setNode] = useState("");
  const [storage, setStorage] = useState("");
  const [force, setForce] = useState(true);
  const [startAfter, setStartAfter] = useState(false);
  const [busy, setBusy] = useState(false);
  const [upid, setUpid] = useState<string | null>(null);
  const [finished, setFinished] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [pickedVolid, setPickedVolid] = useState<string | null>(null);
  const settledRef = useRef(false);
  const picking = Boolean(pickFor);

  const { data: fetchedOverview } = useQuery({
    queryKey: ["backups", hostId],
    queryFn: () => api<BackupOverview>(`/api/hosts/${hostId}/backups`),
    enabled: open,
    staleTime: 60_000,
  });
  const overview = overviewProp ?? fetchedOverview;

  const { data: filesPayload, isLoading: filesLoading } = useQuery({
    queryKey: ["backup-files", hostId],
    queryFn: () => api<{ files: BackupFile[] }>(`/api/hosts/${hostId}/backups/files`),
    enabled: open && picking,
    staleTime: 30_000,
  });

  const guestFiles = useMemo(() => {
    if (!pickFor) return fileProp ? [fileProp] : [];
    return backupsForGuestNewestFirst(filesPayload?.files ?? [], pickFor.vmid, pickFor.kind);
  }, [fileProp, filesPayload?.files, pickFor]);

  const file = useMemo(
    () => guestFiles.find((entry) => entry.volid === pickedVolid) ?? (!picking ? (fileProp ?? null) : null),
    [fileProp, guestFiles, pickedVolid, picking],
  );

  useEffect(() => {
    if (!open) {
      setPickedVolid(null);
      return;
    }
    if (fileProp?.volid) {
      setPickedVolid(fileProp.volid);
      return;
    }
    setPickedVolid(null);
  }, [open, fileProp?.volid, pickFor?.kind, pickFor?.vmid]);

  useEffect(() => {
    if (!open || !picking || pickedVolid || !guestFiles.length) return;
    setPickedVolid(guestFiles[0].volid);
  }, [guestFiles, open, pickedVolid, picking]);

  useEffect(() => {
    if (!open) return;
    setVmid(String(pickFor?.vmid ?? fileProp?.vmid ?? ""));
    setForce(true);
    setStartAfter(false);
    setFinished(false);
    setErrorMsg(null);
  }, [open, pickFor?.vmid, fileProp?.vmid]);

  useEffect(() => {
    if (!open || busy || upid) return;
    if (file?.node) setNode(file.node);
    else setNode((current) => current || overview?.primaryNode || overview?.nodes[0] || "");
    setStorage((current) => current || overview?.diskStorages[0] || "");
  }, [busy, file?.node, open, overview?.diskStorages, overview?.nodes, overview?.primaryNode, upid]);

  const target = useMemo(() => {
    const id = Number(vmid);
    if (!id) return null;
    return overview?.guests.find((g) => g.vmid === id) ?? null;
  }, [overview?.guests, vmid]);

  const kind = target?.kind ?? pickFor?.kind ?? (file?.kind === "vm" ? "vm" : "lxc");
  const kindLabel = t(kind === "vm" ? "backup.kind.vm" : "backup.kind.lxc");
  const running = guestNeedsStopForRestore(target?.status);
  const shutdownRestore = force && running;
  const tracking = Boolean(upid) && !finished && !errorMsg;
  const dateLocale = locale === "en" ? "en-GB" : "de-DE";

  const { data: task } = useQuery({
    queryKey: ["restore-task", hostId, node, upid],
    enabled: Boolean(open && upid),
    queryFn: () =>
      api<TaskPayload>(
        `/api/hosts/${hostId}/backups/task?node=${encodeURIComponent(node)}&upid=${encodeURIComponent(upid!)}`,
      ),
    refetchInterval: tracking ? 1200 : false,
  });

  const logLines = normalizeProxmoxTaskLog(task?.log).map((l) => l.t);
  const showProgress = busy || Boolean(upid);

  useEffect(() => {
    if (!task?.status || finished || errorMsg || settledRef.current) return;
    const st = task.status;
    if (!st.status || st.status === "running") return;
    settledRef.current = true;
    if (isFailedTaskExit(st)) {
      const message = st.exitstatus || t("backup.restoreFailed");
      setErrorMsg(message);
      setBusy(false);
      toast.error(message);
      return;
    }
    setFinished(true);
    setBusy(false);
    toast.success(t("backup.restoreDone"));
    onDone();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task]);

  useEffect(() => {
    if (!finished) return;
    const timer = window.setTimeout(() => {
      setBusy(false);
      setUpid(null);
      setFinished(false);
      setErrorMsg(null);
      settledRef.current = false;
      onOpenChange(false);
    }, 800);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finished]);

  function resetAndClose() {
    setBusy(false);
    setUpid(null);
    setFinished(false);
    setErrorMsg(null);
    settledRef.current = false;
    onOpenChange(false);
  }

  async function submit() {
    if (!file) return;
    setBusy(true);
    setUpid(null);
    setFinished(false);
    setErrorMsg(null);
    settledRef.current = false;
    try {
      const res = await api<{ upid?: string }>(`/api/hosts/${hostId}/backups`, {
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
      if (!res.upid) throw new Error(t("common.failed"));
      setUpid(res.upid);
    } catch (e) {
      setBusy(false);
      toast.error(e instanceof Error ? e.message : t("common.failed"));
    }
  }

  const locked = showProgress && !finished && !errorMsg;
  const nodes = overview?.nodes ?? [];
  const diskStorages = overview?.diskStorages ?? [];

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && locked) return;
        if (!next) {
          setBusy(false);
          setUpid(null);
          setFinished(false);
          setErrorMsg(null);
        }
        onOpenChange(next);
      }}
    >
      <DialogContent className={showProgress ? "max-w-2xl" : undefined}>
        <DialogHeader>
          <DialogTitle>{t("backup.restoreTitle")}</DialogTitle>
          <DialogDescription>
            {showProgress
              ? finished
                ? t("backup.restoreDone")
                : errorMsg
                  ? t("backup.restoreFailed")
                  : upid
                    ? t("backup.restoreWorking")
                    : t("backup.restoreShutdownWait")
              : shutdownRestore
                ? t("backup.restoreRunningBody", { kind: kindLabel, id: vmid })
                : t("backup.restoreBody")}
          </DialogDescription>
        </DialogHeader>
        {picking ? null : <p className="break-all text-xs text-muted-foreground">{file?.volid}</p>}
        {showProgress ? (
          <div className="mt-3 grid gap-3">
            {errorMsg ? <p className="text-sm text-danger">{errorMsg}</p> : null}
            <ProxmoxTaskProgress
              lines={logLines}
              running={!finished && !errorMsg}
              fallbackDetail={upid ? t("backup.restoreWorking") : t("backup.restoreShutdownWait")}
            />
            <div className="flex justify-end">
              <Button variant="outline" onClick={resetAndClose} disabled={locked}>
                {finished || errorMsg ? t("common.close") : t("common.cancel")}
              </Button>
            </div>
          </div>
        ) : (
          <div className="mt-3 grid gap-3">
            {picking ? (
              <div className="space-y-2">
                <p className="text-sm font-medium">{t("backup.restorePick")}</p>
                <p className="text-xs text-muted-foreground">{t("backup.restorePickHint")}</p>
                {filesLoading ? (
                  <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
                ) : guestFiles.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t("backup.noFiles")}</p>
                ) : (
                  <ul className="max-h-48 space-y-1 overflow-auto rounded-md border border-border p-2">
                    {guestFiles.map((entry, index) => {
                      const parsed = parseBackupVolid(entry.volid);
                      const when = entry.ctime ? new Date(entry.ctime).toLocaleString(dateLocale) : "—";
                      return (
                        <li key={entry.volid}>
                          <label className="flex cursor-pointer items-start gap-2 rounded-md px-1 py-1 text-sm hover:bg-white/[0.04]">
                            <input
                              type="radio"
                              className="mt-1"
                              name="restore-backup"
                              checked={pickedVolid === entry.volid}
                              onChange={() => setPickedVolid(entry.volid)}
                            />
                            <span className="min-w-0">
                              <span className="block truncate font-mono text-xs">
                                {parsed.filename}
                                {index === 0 ? ` · ${t("backup.restoreLatest")}` : ""}
                              </span>
                              <span className="text-xs text-muted-foreground">
                                {when} · {bytesToSize(entry.size)} · {entry.storage}
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
            <div className="space-y-1">
              <Label>{t("create.id")}</Label>
              <Input value={vmid} onChange={(e) => setVmid(e.target.value)} />
            </div>
            <label className="text-sm">
              {t("backup.node")}
              <select className={SELECT_CLASS} value={node} onChange={(e) => setNode(e.target.value)}>
                {nodes.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              {t("backup.targetStorage")}
              <select className={SELECT_CLASS} value={storage} onChange={(e) => setStorage(e.target.value)}>
                {diskStorages.map((s) => (
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
            {force ? <p className="text-xs text-muted-foreground">{t("backup.restoreForceHint")}</p> : null}
            {running && !force ? (
              <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
                {t("backup.restoreRunningBody", { kind: kindLabel, id: vmid })}
              </p>
            ) : null}
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={startAfter} onChange={(e) => setStartAfter(e.target.checked)} />
              {t("backup.startAfter")}
            </label>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                {t("common.cancel")}
              </Button>
              <Button
                variant={shutdownRestore ? "destructive" : "default"}
                onClick={() => void submit()}
                disabled={!file || !Number(vmid) || !node || !storage || (running && !force)}
              >
                {shutdownRestore
                  ? t("backup.restoreRunningAction", { kind: kindLabel })
                  : t("backup.restoreAction")}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
