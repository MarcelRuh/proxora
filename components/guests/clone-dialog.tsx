"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input, Label } from "@/components/ui/input";
import { api } from "@/lib/api";
import { useI18n } from "@/components/i18n/locale-provider";

export function CloneDialog({
  kind,
  hostId,
  vmid,
  name,
  path,
  onDone,
}: {
  kind: "vm" | "lxc";
  hostId: string;
  vmid: number;
  name: string;
  path: string;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [newid, setNewid] = useState(String(vmid + 1));
  const [cloneName, setCloneName] = useState(`${name}-clone`);
  const { data } = useQuery({
    queryKey: ["nextid", hostId],
    queryFn: () => api<{ nextid: number | null }>(`/api/hosts/${hostId}/nextid`),
    enabled: open,
    staleTime: 30_000,
  });

  useEffect(() => {
    if (data?.nextid) setNewid(String(data.nextid));
  }, [data?.nextid]);

  useEffect(() => {
    setCloneName(`${name}-clone`);
  }, [name]);

  async function submit() {
    setBusy(true);
    try {
      const body =
        kind === "vm"
          ? { action: "clone", newid: Number(newid), name: cloneName }
          : { action: "clone", newid: Number(newid), hostname: cloneName };
      await api(path, { method: "POST", body: JSON.stringify(body) });
      toast.success(t("guest.cloned"));
      setOpen(false);
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        {t("guest.clone")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("guest.cloneTitle", { kind: kind.toUpperCase(), id: vmid })}</DialogTitle>
            <DialogDescription>{t("guest.cloneBody")}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="space-y-1">
              <Label>{t("guest.cloneId")}</Label>
              <Input value={newid} onChange={(e) => setNewid(e.target.value)} />
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
        </DialogContent>
      </Dialog>
    </>
  );
}
