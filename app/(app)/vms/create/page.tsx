"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { useState, useEffect, useMemo } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";
import { api } from "@/lib/api";
import type { PublicHost } from "@/lib/types";
import { PageHeader } from "@/components/layout/page-header";
import { CreateIpFields, ipFieldsFromVmid } from "@/components/guests/create-ip-fields";
import { DEFAULT_GUEST_NETWORK } from "@/lib/create-ip";
import type { LxcIpMode } from "@/lib/lxc-net";
import { useI18n } from "@/components/i18n/locale-provider";

type Options = {
  nodes: Array<{ node: string }>;
  nextid: number | null;
  storage: Array<{ storage: string; content?: string }>;
  isos: Array<{ volid?: string }>;
  bridges: Array<{ iface?: string }>;
};

const selectClass =
  "mt-1 h-9 w-full rounded-[4px] border border-input bg-white/[0.03] px-2 text-sm";

export default function CreateVmPage() {
  const { t } = useI18n();
  const router = useRouter();
  const { data: hosts } = useQuery({
    queryKey: ["hosts"],
    queryFn: () => api<{ hosts: PublicHost[] }>("/api/hosts"),
  });
  const [form, setForm] = useState({
    hostId: "",
    node: "",
    vmid: 0,
    name: "",
    iso: "",
    diskStorage: "",
    diskSize: "32",
    cores: 2,
    memory: 2048,
    bridge: "",
    ipMode: "static" as LxcIpMode,
    network: DEFAULT_GUEST_NETWORK,
    cidr: "",
    gateway: "",
    startAfter: true,
  });
  const { data: options } = useQuery({
    queryKey: ["options", form.hostId],
    enabled: Boolean(form.hostId),
    queryFn: () => api<Options>(`/api/hosts/${form.hostId}/options`),
  });

  useEffect(() => {
    const only = hosts?.hosts;
    if (!form.hostId && only?.length === 1 && only[0]) {
      setForm((f) => ({ ...f, hostId: only[0]!.id }));
    }
  }, [hosts, form.hostId]);

  const imageStores = useMemo(
    () => (options?.storage ?? []).filter((s) => (s.content ?? "").includes("images")),
    [options],
  );
  const isos = useMemo(
    () => (options?.isos ?? []).map((i) => String(i.volid ?? "")).filter(Boolean),
    [options],
  );
  const bridges = useMemo(
    () => (options?.bridges ?? []).map((b) => String(b.iface ?? "")).filter(Boolean),
    [options],
  );

  useEffect(() => {
    if (!options) return;
    setForm((f) => {
      const node =
        f.node && options.nodes.some((n) => n.node === f.node) ? f.node : (options.nodes[0]?.node ?? "");
      const stores = (options.storage ?? []).filter((s) => (s.content ?? "").includes("images"));
      const storageList = stores.length ? stores : (options.storage ?? []);
      const diskStorage =
        f.diskStorage && storageList.some((s) => s.storage === f.diskStorage)
          ? f.diskStorage
          : (storageList[0]?.storage ?? "local-lvm");
      const bridgeList = (options.bridges ?? []).map((b) => String(b.iface ?? "")).filter(Boolean);
      const bridge = f.bridge && bridgeList.includes(f.bridge) ? f.bridge : (bridgeList[0] ?? "vmbr0");
      const vmid = f.vmid > 0 ? f.vmid : (options.nextid ?? 0);
      const isoList = (options.isos ?? []).map((i) => String(i.volid ?? "")).filter(Boolean);
      const iso = f.iso && isoList.includes(f.iso) ? f.iso : "";
      const ip =
        f.ipMode === "static" && !f.cidr.trim()
          ? ipFieldsFromVmid(f.network || DEFAULT_GUEST_NETWORK, vmid)
          : {};
      return { ...f, node, diskStorage, bridge, vmid, iso, ...ip };
    });
  }, [options]);

  const create = useMutation({
    mutationFn: () => {
      const node = form.node || options?.nodes[0]?.node || "";
      const vmid = form.vmid || options?.nextid || 0;
      return api(`/api/hosts/${form.hostId}/vms`, {
        method: "POST",
        body: JSON.stringify({
          node,
          vmid,
          name: form.name.trim(),
          iso: form.iso || undefined,
          diskStorage: form.diskStorage,
          diskSize: String(Number(form.diskSize) || 32),
          cores: form.cores,
          memory: form.memory,
          bridge: form.bridge,
          startAfter: form.startAfter,
          discard: true,
          ssd: true,
          ipv4: form.ipMode === "dhcp" ? "dhcp" : form.cidr,
          gateway: form.ipMode === "static" ? form.gateway : undefined,
        }),
      });
    },
    onSuccess: () => {
      toast.success(t("vms.created"));
      router.push("/vms");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const canSubmit =
    Boolean(form.hostId) &&
    Boolean(form.node || options?.nodes[0]?.node) &&
    (form.vmid > 0 || Boolean(options?.nextid)) &&
    form.name.trim().length > 0 &&
    Boolean(form.diskStorage) &&
    Boolean(form.bridge) &&
    (form.ipMode === "dhcp" || (form.cidr.trim().length > 0 && form.gateway.trim().length > 0));

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <PageHeader kicker={t("vms.kicker")} title={t("vms.create")} />
      <Card>
        <CardContent className="grid gap-3 pt-5 md:grid-cols-2">
          <label className="text-sm md:col-span-2">
            {t("create.host")}
            <select
              className={selectClass}
              value={form.hostId}
              onChange={(e) =>
                setForm({ ...form, hostId: e.target.value, node: "", iso: "", diskStorage: "", bridge: "", vmid: 0 })
              }
            >
              <option value="">{t("common.chooseHost")}</option>
              {(hosts?.hosts ?? []).map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name}
                </option>
              ))}
            </select>
          </label>
          {(options?.nodes.length ?? 0) > 1 ? (
            <label className="text-sm">
              {t("create.node")}
              <select className={selectClass} value={form.node} onChange={(e) => setForm({ ...form, node: e.target.value })}>
                {(options?.nodes ?? []).map((n) => (
                  <option key={n.node} value={n.node}>
                    {n.node}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <Field
            label={t("create.id")}
            value={form.vmid ? String(form.vmid) : ""}
            onChange={(v) => {
              const vmid = Number(v) || 0;
              setForm({
                ...form,
                vmid,
                ...(form.ipMode === "static" ? ipFieldsFromVmid(form.network, vmid) : {}),
              });
            }}
          />
          <Field label={t("create.name")} value={form.name} onChange={(name) => setForm({ ...form, name })} />
          <label className="text-sm md:col-span-2">
            {t("create.iso")}
            <select className={selectClass} value={form.iso} onChange={(e) => setForm({ ...form, iso: e.target.value })}>
              <option value="">{t("common.none")}</option>
              {isos.map((volid) => (
                <option key={volid} value={volid}>
                  {volid.split("/").pop() ?? volid}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            {t("create.storage")}
            <select className={selectClass} value={form.diskStorage} onChange={(e) => setForm({ ...form, diskStorage: e.target.value })}>
              {(imageStores.length ? imageStores : (options?.storage ?? [])).map((s) => (
                <option key={s.storage} value={s.storage}>
                  {s.storage}
                </option>
              ))}
            </select>
          </label>
          <Field label={t("create.disk")} value={form.diskSize} onChange={(diskSize) => setForm({ ...form, diskSize })} />
          <Field label={t("create.cores")} value={String(form.cores)} onChange={(v) => setForm({ ...form, cores: Number(v) || 1 })} />
          <Field label={t("create.memory")} value={String(form.memory)} onChange={(v) => setForm({ ...form, memory: Number(v) || 512 })} />
          <label className="text-sm">
            {t("create.bridge")}
            <select className={selectClass} value={form.bridge} onChange={(e) => setForm({ ...form, bridge: e.target.value })}>
              {(bridges.length ? bridges : ["vmbr0"]).map((iface) => (
                <option key={iface} value={iface}>
                  {iface}
                </option>
              ))}
            </select>
          </label>
          <CreateIpFields
            value={{ ipMode: form.ipMode, network: form.network, cidr: form.cidr, gateway: form.gateway }}
            vmid={form.vmid}
            onChange={(ip) => setForm({ ...form, ...ip })}
          />
          <label className="flex items-center gap-2 text-sm md:col-span-2">
            <input
              type="checkbox"
              checked={form.startAfter}
              onChange={(e) => setForm({ ...form, startAfter: e.target.checked })}
            />
            {t("create.startAfter")}
          </label>
          <div className="md:col-span-2">
            <Button onClick={() => create.mutate()} disabled={create.isPending || !canSubmit}>
              {create.isPending ? t("create.creating") : t("create.submitVm")}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      <Input value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}
