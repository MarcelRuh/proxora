"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/layout/page-header";

export default function NotificationsSettingsPage() {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["notifications"],
    queryFn: () => api<{ channels: Array<{ id: string; type: string; name: string; enabled: boolean }> }>("/api/notifications"),
  });
  const [form, setForm] = useState({ type: "discord", name: "Discord", url: "" });
  const create = useMutation({
    mutationFn: () =>
      api("/api/notifications", {
        method: "POST",
        body: JSON.stringify({ type: form.type, name: form.name, config: { url: form.url } }),
      }),
    onSuccess: () => {
      toast.success("Channel saved (encrypted)");
      void qc.invalidateQueries({ queryKey: ["notifications"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-4">
      <PageHeader kicker="System" title="Meldungen" />
      <Card>
        <CardHeader>
          <CardTitle>Channels</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {(data?.channels ?? []).map((c) => (
            <div key={c.id} className="flex justify-between">
              <span>
                {c.name} · {c.type}
              </span>
              <span>{c.enabled ? "enabled" : "disabled"}</span>
            </div>
          ))}
          {(data?.channels ?? []).length === 0 ? <p className="text-muted-foreground">No channels yet.</p> : null}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Add webhook</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3">
          <div className="space-y-1">
            <Label>Name</Label>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div className="space-y-1">
            <Label>Discord / webhook URL</Label>
            <Input value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} />
          </div>
          <Button onClick={() => create.mutate()}>Save channel</Button>
          <p className="text-xs text-muted-foreground">Delivery workers are pluggable. Channel secrets are stored encrypted.</p>
        </CardContent>
      </Card>
    </div>
  );
}
