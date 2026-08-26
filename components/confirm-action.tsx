"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";

export function ConfirmAction({
  title,
  description,
  confirmText,
  actionLabel,
  destructive,
  onConfirm,
  children,
}: {
  title: string;
  description: string;
  confirmText?: string;
  actionLabel: string;
  destructive?: boolean;
  onConfirm: () => Promise<void>;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const can = !confirmText || typed === confirmText;

  return (
    <>
      <span onClick={() => setOpen(true)}>{children}</span>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          {confirmText ? (
            <div className="space-y-2">
              <p className="text-sm">
                Type <span className="font-mono font-semibold">{confirmText}</span> to confirm.
              </p>
              <Input value={typed} onChange={(e) => setTyped(e.target.value)} />
            </div>
          ) : null}
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              variant={destructive ? "destructive" : "default"}
              disabled={!can || busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await onConfirm();
                  setOpen(false);
                } finally {
                  setBusy(false);
                }
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

export function useGuestAction(path: string, invalidateKey: unknown[]) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) => api(path, { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => {
      toast.success("Task started");
      void qc.invalidateQueries({ queryKey: invalidateKey });
    },
    onError: (err: Error) => toast.error(err.message),
  });
}
