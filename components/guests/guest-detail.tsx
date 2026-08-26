"use client";

import { useParams, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Textarea } from "@/components/ui/input";
import { GuestStateBadge } from "@/components/status-badge";
import { ConfirmAction } from "@/components/confirm-action";
import { WebConsole } from "@/components/console/web-console";
import { api } from "@/lib/api";

export default function GuestDetailPage({ kind }: { kind: "vm" | "lxc" }) {
  const params = useParams<{ hostId: string; node: string; vmid: string }>();
  const search = useSearchParams();
  const [tab, setTab] = useState(search.get("tab") ?? "overview");
  const path = `/api/hosts/${params.hostId}/${kind === "vm" ? "vms" : "lxc"}/${params.node}/${params.vmid}`;
  const { data, refetch } = useQuery({
    queryKey: ["guest", kind, params.hostId, params.node, params.vmid],
    queryFn: () => api<{ status: Record<string, unknown>; config: Record<string, string>; snapshots: Array<Record<string, string>> }>(path),
    refetchInterval: 5_000,
  });
  const [snap, setSnap] = useState("");
  const [configText, setConfigText] = useState("");

  async function action(name: string, extra: Record<string, unknown> = {}) {
    await api(path, { method: "POST", body: JSON.stringify({ action: name, ...extra }) });
    toast.success("Task started");
    void refetch();
  }

  const status = String(data?.status?.status ?? "unknown");
  const name = String(data?.config?.name ?? data?.config?.hostname ?? params.vmid);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">
            {kind.toUpperCase()} {params.vmid} — {name}
          </h1>
          <p className="text-sm text-muted-foreground">
            {params.node} · {params.hostId}
          </p>
        </div>
        <GuestStateBadge status={status} />
      </div>
      <div className="flex flex-wrap gap-2">
        {["overview", "console", "snapshots", "config"].map((t) => (
          <Button key={t} size="sm" variant={tab === t ? "default" : "outline"} onClick={() => setTab(t)}>
            {t}
          </Button>
        ))}
      </div>
      {tab === "overview" ? (
        <Card>
          <CardHeader>
            <CardTitle>Power</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Button onClick={() => void action("start")}>Start</Button>
            <Button variant="outline" onClick={() => void action("shutdown")}>
              Shutdown
            </Button>
            <Button variant="outline" onClick={() => void action("stop")}>
              Stop
            </Button>
            <Button variant="outline" onClick={() => void action("reboot")}>
              Reboot
            </Button>
            {kind === "vm" ? (
              <>
                <Button variant="outline" onClick={() => void action("pause")}>
                  Pause
                </Button>
                <Button variant="outline" onClick={() => void action("resume")}>
                  Resume
                </Button>
                <ConfirmAction
                  title="Hard reset?"
                  description="This is equivalent to pulling the power, then powering on."
                  actionLabel="Reset"
                  destructive
                  onConfirm={() => action("reset", { confirm: true })}
                >
                  <Button variant="destructive">Reset</Button>
                </ConfirmAction>
              </>
            ) : null}
            <ConfirmAction
              title={`Delete ${kind.toUpperCase()} ${params.vmid}?`}
              description={`This action cannot be undone. ${params.vmid} — ${name}`}
              confirmText="DELETE"
              actionLabel="Delete"
              destructive
              onConfirm={() => action("delete", { confirm: true })}
            >
              <Button variant="destructive">Delete</Button>
            </ConfirmAction>
          </CardContent>
        </Card>
      ) : null}
      {tab === "console" ? (
        <WebConsole hostId={params.hostId} node={params.node} kind={kind} vmid={Number(params.vmid)} />
      ) : null}
      {tab === "snapshots" ? (
        <Card>
          <CardHeader>
            <CardTitle>Snapshots</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex gap-2">
              <Input placeholder="snapshot name" value={snap} onChange={(e) => setSnap(e.target.value)} />
              <Button onClick={() => void action("snapshot", { snapname: snap || `snap-${Date.now()}` })}>Create</Button>
            </div>
            {(data?.snapshots ?? []).map((s) => (
              <div key={String(s.name)} className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm">
                <span>{String(s.name)}</span>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => void action("snapshot-rollback", { snapname: s.name })}>
                    Restore
                  </Button>
                  <Button size="sm" variant="destructive" onClick={() => void action("snapshot-delete", { snapname: s.name })}>
                    Delete
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}
      {tab === "config" ? (
        <Card>
          <CardHeader>
            <CardTitle>Configuration</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <pre className="max-h-80 overflow-auto rounded-md bg-muted p-3 text-xs">
              {JSON.stringify(data?.config, null, 2)}
            </pre>
            <Textarea
              placeholder='{"memory": 2048, "cores": 2}'
              value={configText}
              onChange={(e) => setConfigText(e.target.value)}
            />
            <Button
              onClick={() => {
                const parsed = JSON.parse(configText) as Record<string, unknown>;
                void action("config", { config: parsed });
              }}
            >
              Apply JSON patch
            </Button>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
