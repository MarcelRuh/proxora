"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";
import { api } from "@/lib/api";
import { useI18n } from "@/components/i18n/locale-provider";

type FwPayload = {
  options: Record<string, unknown>;
  rules: Array<Record<string, unknown>>;
};

export function GuestFirewallCard({
  hostId,
  kind,
  node,
  vmid,
  canEdit,
}: {
  hostId: string;
  kind: "vm" | "lxc";
  node: string;
  vmid: number;
  canEdit: boolean;
}) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const path = `/api/hosts/${hostId}/${kind === "vm" ? "vms" : "lxc"}/${node}/${vmid}/firewall`;
  const { data } = useQuery({
    queryKey: ["guest-fw", kind, hostId, node, vmid],
    queryFn: () => api<FwPayload>(path),
  });
  const [dport, setDport] = useState("22");
  const [proto, setProto] = useState("tcp");
  const enabled = Number(data?.options.enable ?? 0) === 1;

  function refresh() {
    void qc.invalidateQueries({ queryKey: ["guest-fw", kind, hostId, node, vmid] });
  }

  const toggle = useMutation({
    mutationFn: (enable: number) => api(path, { method: "PUT", body: JSON.stringify({ enable }) }),
    onSuccess: () => {
      toast.success(t("fw.saved"));
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const add = useMutation({
    mutationFn: () =>
      api(path, {
        method: "POST",
        body: JSON.stringify({ type: "in", action: "ACCEPT", enable: 1, proto, dport }),
      }),
    onSuccess: () => {
      toast.success(t("fw.ruleAdded"));
      setDport("");
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const remove = useMutation({
    mutationFn: (pos: number) => api(`${path}?pos=${pos}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success(t("fw.ruleDeleted"));
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("fw.title")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-muted-foreground">{t("fw.body")}</p>
        {canEdit ? (
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => toggle.mutate(e.target.checked ? 1 : 0)}
              disabled={toggle.isPending}
            />
            {t("fw.enable")}
          </label>
        ) : (
          <p>{enabled ? t("fw.on") : t("fw.off")}</p>
        )}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[28rem] text-left text-xs">
            <thead>
              <tr className="text-muted-foreground">
                <th className="py-1 pr-2">#</th>
                <th className="py-1 pr-2">{t("fw.action")}</th>
                <th className="py-1 pr-2">{t("fw.proto")}</th>
                <th className="py-1 pr-2">{t("fw.dport")}</th>
                <th className="py-1 pr-2">{t("fw.comment")}</th>
                {canEdit ? <th /> : null}
              </tr>
            </thead>
            <tbody>
              {(data?.rules ?? []).map((rule) => {
                const pos = Number(rule.pos);
                return (
                  <tr key={String(rule.pos)} className="border-t border-border">
                    <td className="py-1 pr-2 font-mono">{String(rule.pos ?? "")}</td>
                    <td className="py-1 pr-2">{String(rule.action ?? "")}</td>
                    <td className="py-1 pr-2">{String(rule.proto ?? "—")}</td>
                    <td className="py-1 pr-2">{String(rule.dport ?? "—")}</td>
                    <td className="py-1 pr-2">{String(rule.comment ?? "")}</td>
                    {canEdit ? (
                      <td className="py-1">
                        <Button size="sm" variant="ghost" onClick={() => remove.mutate(pos)} disabled={!Number.isInteger(pos)}>
                          {t("settings.remove")}
                        </Button>
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {canEdit ? (
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1">
              <Label>{t("fw.proto")}</Label>
              <Input value={proto} onChange={(e) => setProto(e.target.value)} className="w-24 font-mono" />
            </div>
            <div className="space-y-1">
              <Label>{t("fw.dport")}</Label>
              <Input value={dport} onChange={(e) => setDport(e.target.value)} className="w-28 font-mono" />
            </div>
            <Button size="sm" onClick={() => add.mutate()} disabled={add.isPending || !dport.trim()}>
              {t("fw.add")}
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
