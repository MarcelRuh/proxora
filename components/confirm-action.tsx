"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useI18n } from "@/components/i18n/locale-provider";

export function ConfirmAction({
  title,
  description,
  actionLabel,
  destructive,
  onConfirm,
  children,
}: {
  title: string;
  description: string;
  actionLabel: string;
  destructive?: boolean;
  onConfirm: () => Promise<void>;
  children: React.ReactNode;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  return (
    <>
      <span
        onClick={() => {
          if (!busy) setOpen(true);
        }}
      >
        {children}
      </span>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (next && busy) return;
          setOpen(next);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>
              {t("common.cancel")}
            </Button>
            <Button
              variant={destructive ? "destructive" : "default"}
              disabled={busy}
              onClick={() => {
                setBusy(true);
                setOpen(false);
                void onConfirm()
                  .catch((err: unknown) => {
                    toast.error(err instanceof Error ? err.message : t("common.failed"));
                  })
                  .finally(() => {
                    setBusy(false);
                  });
              }}
            >
              {actionLabel}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
