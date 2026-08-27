"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ConfirmAction } from "@/components/confirm-action";
import { WebConsole } from "@/components/console/web-console";
import { api } from "@/lib/api";
import type { PublicHost } from "@/lib/types";

type AptPackage = { Package: string; Version?: string; OldVersion?: string };
type HostUpdates = {
  host: PublicHost;
  version: string | null;
  updates: Array<{ node: string; count: number; packages: AptPackage[] }>;
  error: string | null;
};

export default function UpdatesPage() {
  const qc = useQueryClient();
  const [shell, setShell] = useState<{ hostId: string; node: string; name: string } | null>(null);
  const { data: hosts } = useQuery({
    queryKey: ["hosts"],
    queryFn: () => api<{ hosts: PublicHost[] }>("/api/hosts"),
  });
  const { data: jobs } = useQuery({
    queryKey: ["update-jobs"],
    queryFn: () =>
      api<{
        jobs: Array<{ id: string; status: string; host?: { name: string } | null; error?: string | null }>;
      }>("/api/updates"),
    refetchInterval: 5_000,
  });
  const { data: details, isFetching } = useQuery({
    queryKey: ["update-details", hosts?.hosts.map((h) => h.id)],
    enabled: Boolean(hosts),
    queryFn: async () => {
      return Promise.all(
        (hosts?.hosts ?? []).map(async (h) => {
          try {
            const r = await api<{ version: string | null; updates: HostUpdates["updates"] }>(
              `/api/hosts/${h.id}/updates`,
            );
            return { host: h, ...r, error: null as string | null };
          } catch (e) {
            return {
              host: h,
              version: h.proxmoxVersion,
              updates: [],
              error: e instanceof Error ? e.message : "Aktualisierungsliste fehlgeschlagen",
            };
          }
        }),
      );
    },
  });

  const checkOne = useMutation({
    mutationFn: (hostId: string) =>
      api(`/api/hosts/${hostId}/updates`, {
        method: "POST",
        body: JSON.stringify({ action: "check" }),
      }),
    onSuccess: () => {
      toast.success("Paketliste aktualisiert");
      void qc.invalidateQueries({ queryKey: ["update-details"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const checkAll = useMutation({
    mutationFn: async () => {
      const ids = hosts?.hosts.map((h) => h.id) ?? [];
      const results = await Promise.allSettled(
        ids.map((id) =>
          api(`/api/hosts/${id}/updates`, {
            method: "POST",
            body: JSON.stringify({ action: "check" }),
          }),
        ),
      );
      const failed = results.filter((r) => r.status === "rejected").length;
      if (failed) throw new Error(`${failed} Host(s) konnten die Paketliste nicht aktualisieren`);
    },
    onSuccess: () => {
      toast.success("Paketlisten aktualisiert");
      void qc.invalidateQueries({ queryKey: ["update-details"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Updates</h1>
          <p className="text-sm text-muted-foreground">
            Paketlisten der Hosts. Upgrade öffnet die Node-Shell wie in der Proxmox-GUI (`apt dist-upgrade`).
          </p>
        </div>
        <Button
          variant="outline"
          disabled={checkAll.isPending || !hosts?.hosts.length}
          onClick={() => checkAll.mutate()}
        >
          {checkAll.isPending ? "Aktualisiere…" : "Alle Paketlisten prüfen"}
        </Button>
      </div>

      {shell ? (
        <Card>
          <CardHeader>
            <CardTitle>Upgrade-Konsole · {shell.name}</CardTitle>
            <CardDescription>
              Interaktives Upgrade auf {shell.node}. Nach Abschluss die Konsole schließen und die Paketliste neu
              prüfen. Benötigt root@pam, wie in Proxmox selbst.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <WebConsole hostId={shell.hostId} node={shell.node} kind="node" cmd="upgrade" />
            <Button variant="outline" size="sm" onClick={() => setShell(null)}>
              Konsole schließen
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        {(details ?? []).map((row) => {
          const count = row.updates.reduce((acc, n) => acc + n.count, 0);
          const checking = checkOne.isPending && checkOne.variables === row.host.id;
          return (
            <Card key={row.host.id}>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle>{row.host.name}</CardTitle>
                <Badge variant={row.error ? "danger" : count > 0 ? "warning" : "success"}>
                  {row.error ? "Fehler" : `${count} Updates`}
                </Badge>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm text-muted-foreground">Version: {row.version ?? "unbekannt"}</p>
                {row.error ? <p className="text-sm text-destructive">{row.error}</p> : null}
                <ul className="max-h-32 overflow-auto text-xs text-muted-foreground">
                  {row.updates.flatMap((n) =>
                    n.packages.slice(0, 12).map((p) => (
                      <li key={`${n.node}-${p.Package}`}>
                        {p.Package} {p.OldVersion ? `${p.OldVersion} → ` : ""}
                        {p.Version}
                      </li>
                    )),
                  )}
                </ul>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={checking || checkAll.isPending}
                    onClick={() => checkOne.mutate(row.host.id)}
                  >
                    {checking ? "Prüfe…" : "Paketliste prüfen"}
                  </Button>
                  {(row.updates.length ? row.updates : [{ node: "" }]).map((n) => (
                    <ConfirmAction
                      key={n.node || row.host.id}
                      title={`${row.host.name}${n.node ? ` (${n.node})` : ""} upgraden?`}
                      description="Öffnet die Proxmox-Upgrade-Shell (apt dist-upgrade). Du bestätigst dort selbst. Ein stilles API-Upgrade gibt es in Proxmox VE nicht."
                      confirmText="UPGRADE"
                      actionLabel="Upgrade starten"
                      destructive
                      onConfirm={async () => {
                        const r = await api<{ mode: "console"; node: string }>(`/api/hosts/${row.host.id}/updates`, {
                          method: "POST",
                          body: JSON.stringify({
                            action: "upgrade",
                            node: n.node || undefined,
                            confirm: true,
                          }),
                        });
                        setShell({ hostId: row.host.id, node: r.node, name: row.host.name });
                        toast.success("Upgrade-Konsole geöffnet");
                      }}
                    >
                      <Button size="sm">Upgrade {row.updates.length > 1 ? n.node : ""}</Button>
                    </ConfirmAction>
                  ))}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
      {isFetching && !details ? <p className="text-sm text-muted-foreground">Lade Update-Listen…</p> : null}

      {(jobs?.jobs ?? []).length ? (
        <Card>
          <CardHeader>
            <CardTitle>Frühere Update-Jobs</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {(jobs?.jobs ?? []).map((j) => (
              <div key={j.id} className="flex flex-wrap justify-between gap-2">
                <span>{j.host?.name ?? "unbekannt"}</span>
                <div className="flex items-center gap-2">
                  {j.error ? <span className="text-xs text-destructive">{j.error}</span> : null}
                  <Badge variant={j.status === "FAILED" ? "danger" : j.status === "SUCCESS" ? "success" : "warning"}>
                    {j.status}
                  </Badge>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
