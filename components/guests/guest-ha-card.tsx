"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/input";
import { api } from "@/lib/api";
import { useI18n } from "@/components/i18n/locale-provider";

type HaPayload = {
  clustered: boolean;
  resource: Record<string, unknown> | null;
  groups: Array<Record<string, unknown>>;
};

export function GuestHaCard({
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
  const path = `/api/hosts/${hostId}/${kind === "vm" ? "vms" : "lxc"}/${node}/${vmid}/ha`;
  const { data } = useQuery({
    queryKey: ["guest-ha", kind, hostId, node, vmid],
    queryFn: () => api<HaPayload>(path),
  });
  const [group, setGroup] = useState("");
  const save = useMutation({
    mutationFn: (enabled: boolean) =>
      api(path, {
        method: "PUT",
        body: JSON.stringify({ enabled, group: group || undefined, state: "started" }),
      }),
    onSuccess: () => {
      toast.success(t("ha.saved"));
      void qc.invalidateQueries({ queryKey: ["guest-ha", kind, hostId, node, vmid] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!data?.clustered) return null;
  const active = Boolean(data.resource);
  const currentGroup = String(data.resource?.group ?? "");

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("ha.title")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-muted-foreground">{t("ha.body")}</p>
        <p>{active ? t("ha.enabled") : t("ha.disabled")}</p>
        <fieldset disabled={!canEdit} className="space-y-3 border-0 p-0 disabled:opacity-50">
          <div className="space-y-1">
            <Label>{t("ha.group")}</Label>
            <select
              className="flex h-9 w-full max-w-md rounded-[4px] border border-input bg-white/[0.03] px-3 text-sm"
              value={group || currentGroup}
              onChange={(e) => setGroup(e.target.value)}
            >
              <option value="">{t("ha.noGroup")}</option>
              {data.groups.map((g) => {
                const name = String(g.group ?? g.name ?? "");
                return (
                  <option key={name} value={name}>
                    {name}
                  </option>
                );
              })}
            </select>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              onClick={() => save.mutate(true)}
              disabled={save.isPending || !canEdit}
              title={canEdit ? undefined : t("common.noPermission")}
            >
              {t("ha.enable")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => save.mutate(false)}
              disabled={save.isPending || !canEdit || !active}
              title={canEdit ? undefined : t("common.noPermission")}
            >
              {t("ha.disable")}
            </Button>
          </div>
        </fieldset>
      </CardContent>
    </Card>
  );
}
