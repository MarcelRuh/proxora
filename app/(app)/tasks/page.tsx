"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import type { PublicHost } from "@/lib/types";
import { PageHeader } from "@/components/layout/page-header";

type Task = {
  upid: string;
  type: string;
  status?: string;
  starttime: number;
  endtime?: number;
  node: string;
  user: string;
  id?: string;
};

export default function TasksPage() {
  const { data: hosts } = useQuery({
    queryKey: ["hosts"],
    queryFn: () => api<{ hosts: PublicHost[] }>("/api/hosts"),
  });
  const { data } = useQuery({
    queryKey: ["tasks", hosts?.hosts.map((h) => h.id)],
    enabled: Boolean(hosts),
    queryFn: async () => {
      const rows = await Promise.all(
        (hosts?.hosts ?? []).map(async (h) => {
          try {
            const r = await api<{ tasks: Task[] }>(`/api/hosts/${h.id}/tasks`);
            return r.tasks.map((t) => ({ ...t, hostId: h.id, hostName: h.name }));
          } catch {
            return [];
          }
        }),
      );
      return rows.flat().sort((a, b) => b.starttime - a.starttime);
    },
    refetchInterval: 5_000,
  });
  const [open, setOpen] = useState<Task & { hostId: string } | null>(null);
  const { data: detail } = useQuery({
    queryKey: ["task", open?.hostId, open?.node, open?.upid],
    enabled: Boolean(open),
    queryFn: () =>
      api<{ status: Task; log: Array<{ n: number; t: string }> }>(
        `/api/hosts/${open!.hostId}/tasks/${open!.node}/${encodeURIComponent(open!.upid)}`,
      ),
  });

  return (
    <div className="space-y-4">
      <PageHeader kicker="Betrieb" title="Tasks" description="Proxmox-Aufgaben auf allen verbundenen Hosts." />
      <Card>
        <CardHeader>
          <CardTitle>Proxmox tasks</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="py-2">Host</th>
                <th>Type</th>
                <th>ID</th>
                <th>User</th>
                <th>Status</th>
                <th>Start</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {(data ?? []).map((t) => (
                <tr key={t.upid} className="border-t border-border">
                  <td className="py-2">{t.hostName}</td>
                  <td>{t.type}</td>
                  <td>{t.id}</td>
                  <td>{t.user}</td>
                  <td>
                    <Badge variant={t.status === "OK" || t.status === "stopped" ? "success" : t.status ? "warning" : "muted"}>
                      {t.status ?? "running"}
                    </Badge>
                  </td>
                  <td>{new Date(t.starttime * 1000).toLocaleString()}</td>
                  <td>
                    <Button size="sm" variant="outline" onClick={() => setOpen(t)}>
                      Log
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
      {open ? (
        <Card>
          <CardHeader>
            <CardTitle>Task output — {open.upid}</CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="max-h-96 overflow-auto rounded bg-muted p-3 text-xs">
              {(detail?.log ?? []).map((l) => l.t).join("\n") || "Loading…"}
            </pre>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
