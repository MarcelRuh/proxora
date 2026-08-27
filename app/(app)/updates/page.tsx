"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ConfirmAction } from "@/components/confirm-action";
import { api } from "@/lib/api";
import type { PublicHost } from "@/lib/types";

export default function UpdatesPage() {
  const qc = useQueryClient();
  const { data: hosts } = useQuery({
    queryKey: ["hosts"],
    queryFn: () => api<{ hosts: PublicHost[] }>("/api/hosts"),
  });
  const { data: jobs } = useQuery({
    queryKey: ["update-jobs"],
    queryFn: () => api<{ jobs: Array<{ id: string; status: string; host?: { name: string } | null; error?: string | null }> }>("/api/updates"),
    refetchInterval: 5_000,
  });
  const { data: details } = useQuery({
    queryKey: ["update-details", hosts?.hosts.map((h) => h.id)],
    enabled: Boolean(hosts),
    queryFn: async () => {
      return Promise.all(
        (hosts?.hosts ?? []).map(async (h) => {
          try {
            const r = await api<{ version: string | null; updates: Array<{ node: string; count: number; packages: Array<{ Package: string; Version?: string }> }> }>(
              `/api/hosts/${h.id}/updates`,
            );
            return { host: h, ...r, error: null as string | null };
          } catch (e) {
            return { host: h, version: h.proxmoxVersion, updates: [], error: e instanceof Error ? e.message : "Failed" };
          }
        }),
      );
    },
  });

  const updateAll = useMutation({
    mutationFn: () => api("/api/updates", { method: "POST", body: JSON.stringify({ confirm: true }) }),
    onSuccess: () => {
      toast.success("Update queue started");
      void qc.invalidateQueries({ queryKey: ["update-jobs"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Updates</h1>
          <p className="text-sm text-muted-foreground">Proxmox APT-Upgrades auf den verbundenen Hosts.</p>
        </div>
        <ConfirmAction
          title="Update all hosts?"
          description="Each host will refresh its package list and start an APT upgrade via the Proxmox API. Running guests are not automatically migrated."
          confirmText="UPDATE"
          actionLabel="Update all hosts"
          destructive
          onConfirm={async () => {
            await updateAll.mutateAsync();
          }}
        >
          <Button>Update all hosts</Button>
        </ConfirmAction>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {(details ?? []).map((row) => {
          const count = row.updates.reduce((acc, n) => acc + n.count, 0);
          return (
            <Card key={row.host.id}>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle>{row.host.name}</CardTitle>
                <Badge variant={count > 0 ? "warning" : "success"}>{count} updates</Badge>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm text-muted-foreground">Current: {row.version ?? "unknown"}</p>
                {row.error ? <p className="text-sm text-destructive">{row.error}</p> : null}
                <ul className="max-h-32 overflow-auto text-xs text-muted-foreground">
                  {row.updates.flatMap((n) => n.packages.slice(0, 8)).map((p) => (
                    <li key={p.Package}>
                      {p.Package} {p.Version}
                    </li>
                  ))}
                </ul>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={async () => {
                      await api(`/api/hosts/${row.host.id}/updates`, {
                        method: "POST",
                        body: JSON.stringify({ action: "check" }),
                      });
                      toast.success("Package list refreshed");
                      void qc.invalidateQueries({ queryKey: ["update-details"] });
                    }}
                  >
                    Check updates
                  </Button>
                  <ConfirmAction
                    title={`Update ${row.host.name}?`}
                    description="This starts `apt upgrade` through the Proxmox API. Review running guests first."
                    confirmText="UPDATE"
                    actionLabel="Update host"
                    destructive
                    onConfirm={async () => {
                      await api(`/api/hosts/${row.host.id}/updates`, {
                        method: "POST",
                        body: JSON.stringify({ action: "upgrade", confirm: true }),
                      });
                      toast.success("Update job queued");
                      void qc.invalidateQueries({ queryKey: ["update-jobs"] });
                    }}
                  >
                    <Button size="sm">Update host</Button>
                  </ConfirmAction>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Update queue</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {(jobs?.jobs ?? []).map((j) => (
            <div key={j.id} className="flex justify-between">
              <span>{j.host?.name ?? "unknown"}</span>
              <Badge variant={j.status === "FAILED" ? "danger" : j.status === "SUCCESS" ? "success" : "warning"}>
                {j.status}
              </Badge>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
