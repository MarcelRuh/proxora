"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input, Label } from "@/components/ui/input";
import { HostStateBadge } from "@/components/status-badge";
import { ConfirmAction } from "@/components/confirm-action";
import { api } from "@/lib/api";
import type { PublicHost } from "@/lib/types";

type FormState = {
  name: string;
  url: string;
  authType: "API_TOKEN" | "PASSWORD";
  username: string;
  tokenId: string;
  secret: string;
  allowInsecureTls: boolean;
};

const empty: FormState = {
  name: "",
  url: "https://192.168.1.10:8006",
  authType: "API_TOKEN",
  username: "root@pam",
  tokenId: "manager",
  secret: "",
  allowInsecureTls: true,
};

export default function HostsPage() {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["hosts"],
    queryFn: () => api<{ hosts: PublicHost[] }>("/api/hosts"),
    refetchInterval: 20_000,
  });
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(empty);
  const [test, setTest] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () => api("/api/hosts", { method: "POST", body: JSON.stringify(form) }),
    onSuccess: () => {
      toast.success("Host added");
      setOpen(false);
      setForm(empty);
      void qc.invalidateQueries({ queryKey: ["hosts"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Hosts</h1>
          <p className="text-sm text-muted-foreground">Independent Proxmox VE nodes — no cluster required.</p>
        </div>
        <Button onClick={() => setOpen(true)}>Add host</Button>
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {(data?.hosts ?? []).map((host) => (
          <Card key={host.id}>
            <CardHeader className="flex flex-row items-start justify-between">
              <div>
                <CardTitle>{host.name}</CardTitle>
                <p className="text-xs text-muted-foreground">{host.url}</p>
              </div>
              <HostStateBadge state={host.connectionState} />
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm">Proxmox VE {host.proxmoxVersion ?? "—"}</p>
              {host.lastError ? <p className="text-sm text-destructive">{host.lastError}</p> : null}
              <div className="flex flex-wrap gap-2">
                <Button size="sm" asChild>
                  <Link href={`/hosts/${host.id}`}>Open</Link>
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={async () => {
                    try {
                      await api(`/api/hosts/${host.id}/test`, { method: "POST" });
                      toast.success("Connection OK");
                      void qc.invalidateQueries({ queryKey: ["hosts"] });
                    } catch (e) {
                      toast.error(e instanceof Error ? e.message : "Test failed");
                    }
                  }}
                >
                  Test
                </Button>
                <ConfirmAction
                  title={`Remove ${host.name}?`}
                  description="Credentials and host metadata will be deleted from Proxora. Guests on the host are not affected."
                  confirmText="DELETE"
                  actionLabel="Remove host"
                  destructive
                  onConfirm={async () => {
                    await api(`/api/hosts/${host.id}`, { method: "DELETE" });
                    toast.success("Host removed");
                    void qc.invalidateQueries({ queryKey: ["hosts"] });
                  }}
                >
                  <Button size="sm" variant="destructive">
                    Remove
                  </Button>
                </ConfirmAction>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Add Proxmox host</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <Field label="Name" value={form.name} onChange={(v) => setForm({ ...form, name: v })} />
            <Field label="Host" value={form.url} onChange={(v) => setForm({ ...form, url: v })} />
            <div className="grid grid-cols-2 gap-3">
              <Field label="User" value={form.username} onChange={(v) => setForm({ ...form, username: v })} />
              <Field label="Token ID" value={form.tokenId} onChange={(v) => setForm({ ...form, tokenId: v })} />
            </div>
            <Field label="Secret" type="password" value={form.secret} onChange={(v) => setForm({ ...form, secret: v })} />
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.allowInsecureTls}
                onChange={(e) => setForm({ ...form, allowInsecureTls: e.target.checked })}
              />
              Allow self-signed TLS certificates
            </label>
            {test ? <p className="text-sm text-muted-foreground">{test}</p> : null}
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={async () => {
                  try {
                    const r = await api<{ ok: boolean; version?: { version: string }; error?: string }>(
                      "/api/hosts/test",
                      { method: "POST", body: JSON.stringify(form) },
                    );
                    setTest(r.ok ? `Connected · Proxmox ${r.version?.version}` : r.error ?? "Failed");
                  } catch (e) {
                    setTest(e instanceof Error ? e.message : "Failed");
                  }
                }}
              >
                Test connection
              </Button>
              <Button onClick={() => create.mutate()} disabled={create.isPending}>
                Save host
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
}) {
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      <Input type={type} value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}
