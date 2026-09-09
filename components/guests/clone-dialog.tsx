"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input, Label } from "@/components/ui/input";
import { ProxmoxTaskProgress } from "@/components/backups/task-progress";
import { api } from "@/lib/api";
import { isUpid } from "@/lib/guest-task";
import { useI18n } from "@/components/i18n/locale-provider";
import { useProxmoxTask } from "@/components/tasks/use-proxmox-task";

export function CloneDialog({
  kind,
  hostId,
  node,
  vmid,
  name,
  path,
  disabled,
  disabledReason,
  onDone,
}: {
  kind: "vm" | "lxc";
  hostId: string;
  node: string;
  vmid: number;
  name: string;
  path: string;
  disabled?: boolean;
  disabledReason?: string;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [newid, setNewid] = useState(String(vmid + 1));
  const [idTouched, setIdTouched] = useState(false);
  const [cloneName, setCloneName] = useState(`${name}-clone`);
  const [upid, setUpid] = useState<string | null>(null);
  const toastedRef = useRef(false);
  const { data } = useQuery({
    queryKey: ["nextid", hostId],
    queryFn: () => api<{ nextid: number | null }>(`/api/hosts/${hostId}/nextid`),
    enabled: open,
    staleTime: 30_000,
  });

  useEffect(() => {
    if (!open) return;
    setIdTouched(false);
    setNewid(String(vmid + 1));
  }, [open, vmid]);

  useEffect(() => {
    if (data?.nextid && !idTouched) setNewid(String(data.nextid));
  }, [data?.nextid, idTouched]);

  useEffect(() => {
    setCloneName(`${name}-clone`);
  }, [name]);

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
    toastedRef.current = false;
  }, [upid]);

  useEffect(() => {
    if (!open || toastedRef.current || (!finished && !errorMsg)) return;
    toastedRef.current = true;
    if (errorMsg) {
      toast.error(errorMsg);
      return;
    }
    toast.success(t("guest.cloned"));
    onDone();
    const timer = window.setTimeout(() => {
      setOpen(false);
      setBusy(false);
      setUpid(null);
    }, 800);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finished, errorMsg, open]);

  async function submit() {
    setBusy(true);
    try {
      const body =
        kind === "vm"
          ? { action: "clone", newid: Number(newid), name: cloneName, wait: false }
          : { action: "clone", newid: Number(newid), hostname: cloneName, wait: false };
      const res = await api<{ upid?: unknown }>(path, { method: "POST", body: JSON.stringify(body) });
      const next = isUpid(res.upid) ? res.upid : null;
      if (!next) {
        toast.success(t("guest.cloned"));
        setOpen(false);
        onDone();
        setBusy(false);
        return;
      }
      setUpid(next);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.failed"));
      setBusy(false);
    }
  }

  return (
    <>
      <Button variant="outline" disabled={disabled} title={disabled ? disabledReason : undefined} onClick={() => setOpen(true)}>
        {t("guest.clone")}
      </Button>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (locked) return;
          setOpen(next);
          if (!next) {
            setBusy(false);
            setUpid(null);
          }
        }}
      >
        <DialogContent className={tracking ? "max-w-2xl" : undefined}>
          <DialogHeader>
            <DialogTitle>{tracking ? t("guest.cloneProgress") : t("guest.cloneTitle", { kind: kind.toUpperCase(), id: vmid })}</DialogTitle>
            <DialogDescription>
              {tracking
                ? errorMsg
                  ? t("common.failed")
                  : finished
                    ? t("create.progressDone")
                    : t("guest.cloneWorking")
                : t("guest.cloneBody")}
            </DialogDescription>
          </DialogHeader>
          {tracking ? (
            <div className="grid gap-3">
              {errorMsg ? <p className="text-sm text-danger">{errorMsg}</p> : null}
              <ProxmoxTaskProgress
                lines={logLines}
                running={!finished && !errorMsg}
                fallbackDetail={t("guest.cloneWorking")}
              />
              <div className="flex justify-end">
                <Button
                  variant="outline"
                  onClick={() => {
                    setOpen(false);
                    setBusy(false);
                    setUpid(null);
                  }}
                  disabled={locked}
                >
                  {finished || errorMsg ? t("common.close") : t("common.cancel")}
                </Button>
              </div>
            </div>
          ) : (
            <div className="grid gap-3">
              <div className="space-y-1">
                <Label>{t("guest.cloneId")}</Label>
                <Input
                  value={newid}
                  onChange={(e) => {
                    setIdTouched(true);
                    setNewid(e.target.value);
                  }}
                />
              </div>
              <div className="space-y-1">
                <Label>{t("guest.cloneName")}</Label>
                <Input value={cloneName} onChange={(e) => setCloneName(e.target.value)} />
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>
                  {t("common.cancel")}
                </Button>
                <Button onClick={() => void submit()} disabled={busy || !Number(newid) || !cloneName.trim()}>
                  {t("guest.cloneAction")}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
