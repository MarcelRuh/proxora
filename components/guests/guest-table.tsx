"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Play, Square, RotateCcw, Terminal } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { GuestStateBadge } from "@/components/status-badge";
import { ConfirmAction } from "@/components/confirm-action";
import { api } from "@/lib/api";
import { bytesToSize, formatUptime, percentage } from "@/lib/utils";
import type { Guest } from "@/lib/types";

async function guestAction(hostId: string, kind: string, node: string, vmid: number, action: string) {
  await api(`/api/hosts/${hostId}/${kind}/${node}/${vmid}`, {
    method: "POST",
    body: JSON.stringify({ action, confirm: action === "delete" }),
  });
  toast.success("Task started");
}

export function GuestTable({
  kind,
  items,
  hostId,
}: {
  kind: "vm" | "lxc";
  items: Guest[];
  hostId?: string;
}) {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");
  const filtered = useMemo(
    () =>
      items.filter((g) => {
        const match = g.name.toLowerCase().includes(q.toLowerCase()) || String(g.vmid).includes(q);
        return match && (status === "all" || g.status === status);
      }),
    [items, q, status],
  );
  const permPath = kind === "vm" ? "vms" : "lxc";
  const detailBase = kind === "vm" ? "vms" : "containers";

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Input placeholder="Name oder ID" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-xs" />
        <select
          className="h-9 rounded-[4px] border border-input bg-white/[0.03] px-2 text-sm"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="all">Alle Status</option>
          <option value="running">Laufend</option>
          <option value="stopped">Gestoppt</option>
          <option value="paused">Pausiert</option>
        </select>
      </div>
      <div className="overflow-x-auto rounded-[4px] border border-border">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="font-[family-name:var(--font-display)] text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">ID</th>
              <th className="px-3 py-2 font-medium">Name</th>
              <th className="px-3 py-2 font-medium">Host / Node</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">CPU</th>
              <th className="px-3 py-2 font-medium">RAM</th>
              <th className="px-3 py-2 font-medium">Disk</th>
              <th className="px-3 py-2 font-medium">Uptime</th>
              <th className="px-3 py-2 font-medium">Aktionen</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((g) => {
              const hid = g.hostId ?? hostId ?? "";
              return (
                <tr key={`${hid}-${g.node}-${g.vmid}`} className="border-t border-border">
                  <td className="px-3 py-2 font-mono">{g.vmid}</td>
                  <td className="px-3 py-2">
                    <Link className="hover:underline" href={`/${detailBase}/${hid}/${g.node}/${g.vmid}`}>
                      {g.name}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {g.hostName ?? hid} / {g.node}
                  </td>
                  <td className="px-3 py-2">
                    <GuestStateBadge status={g.status} />
                  </td>
                  <td className="px-3 py-2">{Math.round(g.cpu * 100)}%</td>
                  <td className="px-3 py-2">
                    {bytesToSize(g.mem)} / {bytesToSize(g.maxmem)} ({percentage(g.mem, g.maxmem)}%)
                  </td>
                  <td className="px-3 py-2">{bytesToSize(g.maxdisk)}</td>
                  <td className="px-3 py-2">{formatUptime(g.uptime)}</td>
                  <td className="px-3 py-2">
                    <div className="flex gap-1">
                      <Button size="icon" variant="ghost" title="Start" onClick={() => void guestAction(hid, permPath, g.node, g.vmid, "start")}>
                        <Play className="h-4 w-4" />
                      </Button>
                      <Button size="icon" variant="ghost" title="Shutdown" onClick={() => void guestAction(hid, permPath, g.node, g.vmid, "shutdown")}>
                        <Square className="h-4 w-4" />
                      </Button>
                      <Button size="icon" variant="ghost" title="Reboot" onClick={() => void guestAction(hid, permPath, g.node, g.vmid, "reboot")}>
                        <RotateCcw className="h-4 w-4" />
                      </Button>
                      <Button size="icon" variant="ghost" asChild>
                        <Link href={`/${detailBase}/${hid}/${g.node}/${g.vmid}?console=1`}>
                          <Terminal className="h-4 w-4" />
                        </Link>
                      </Button>
                      <ConfirmAction
                        title={`Delete ${kind.toUpperCase()} ${g.vmid}?`}
                        description={`This action cannot be undone. ${g.vmid} — ${g.name}`}
                        actionLabel={`Delete ${kind.toUpperCase()}`}
                        destructive
                        onConfirm={() => guestAction(hid, permPath, g.node, g.vmid, "delete")}
                      >
                        <Button size="sm" variant="destructive">
                          Delete
                        </Button>
                      </ConfirmAction>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
