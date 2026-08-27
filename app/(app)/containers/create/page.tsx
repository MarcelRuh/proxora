"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";
import { api } from "@/lib/api";
import type { PublicHost } from "@/lib/types";
import { PageHeader } from "@/components/layout/page-header";
import type { LxcIpMode } from "@/lib/lxc-net";

type Options = {
  nodes: Array<{ node: string }>;
  nextid: number | null;
  storage: Array<{ storage: string; content?: string }>;
  templates: Array<{ volid?: string }>;
  bridges: Array<{ iface?: string; type?: string }>;
};

const selectClass =
  "mt-1 h-9 w-full rounded-[4px] border border-input bg-white/[0.03] px-2 text-sm";

export default function CreateLxcPage() {
  const router = useRouter();
  const { data: hosts } = useQuery({
    queryKey: ["hosts"],
    queryFn: () => api<{ hosts: PublicHost[] }>("/api/hosts"),
  });
  const [form, setForm] = useState({
    hostId: "",
    node: "",
    vmid: 0,
    hostname: "",
    password: "",
    ostemplate: "",
    storage: "",
    diskSize: "8",
    cores: 2,
    memory: 1024,
    bridge: "",
    ipMode: "dhcp" as LxcIpMode,
    cidr: "",
    gateway: "",
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

  const rootStores = useMemo(
    () => (options?.storage ?? []).filter((s) => (s.content ?? "").includes("rootdir")),
    [options],
  );
  const templates = useMemo(
    () => (options?.templates ?? []).map((t) => String(t.volid ?? "")).filter(Boolean),
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
      const stores = (options.storage ?? []).filter((s) => (s.content ?? "").includes("rootdir"));
      const storageList = stores.length ? stores : (options.storage ?? []);
      const storage =
        f.storage && storageList.some((s) => s.storage === f.storage)
          ? f.storage
          : (storageList[0]?.storage ?? "local-lvm");
      const bridgeList = (options.bridges ?? []).map((b) => String(b.iface ?? "")).filter(Boolean);
      const bridge = f.bridge && bridgeList.includes(f.bridge) ? f.bridge : (bridgeList[0] ?? "vmbr0");
      const vols = (options.templates ?? []).map((t) => String(t.volid ?? "")).filter(Boolean);
      const ostemplate = f.ostemplate && vols.includes(f.ostemplate) ? f.ostemplate : "";
      const vmid = f.vmid > 0 ? f.vmid : (options.nextid ?? 0);
      return { ...f, node, storage, bridge, ostemplate, vmid };
    });
  }, [options]);

  const create = useMutation({
    mutationFn: () => {
      const node = form.node || options?.nodes[0]?.node || "";
      const vmid = form.vmid || options?.nextid || 0;
      return api(`/api/hosts/${form.hostId}/lxc`, {
        method: "POST",
        body: JSON.stringify({
          node,
          vmid,
          hostname: form.hostname.trim(),
          password: form.password,
          ostemplate: form.ostemplate,
          storage: form.storage,
          diskSize: String(Number(form.diskSize) || 8),
          cores: form.cores,
          memory: form.memory,
          bridge: form.bridge,
          ipv4: form.ipMode === "dhcp" ? "dhcp" : form.cidr,
          gateway: form.ipMode === "static" ? form.gateway : undefined,
          unprivileged: true,
          nesting: true,
        }),
      });
    },
    onSuccess: () => {
      toast.success("Container-Erstellung gestartet");
      router.push("/containers");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const canSubmit =
    Boolean(form.hostId) &&
    Boolean(form.node || options?.nodes[0]?.node) &&
    (form.vmid > 0 || Boolean(options?.nextid)) &&
    form.hostname.trim().length > 0 &&
    form.password.length >= 5 &&
    Boolean(form.ostemplate) &&
    Boolean(form.storage) &&
    Boolean(form.bridge) &&
    (form.ipMode === "dhcp" || (form.cidr.trim().length > 0 && form.gateway.trim().length > 0));

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <PageHeader kicker="Virtualisierung" title="Container erstellen" />
      <Card>
        <CardContent className="grid gap-3 pt-5 md:grid-cols-2">
          <label className="text-sm md:col-span-2">
            Host
            <select
              className={selectClass}
              value={form.hostId}
              onChange={(e) =>
                setForm({ ...form, hostId: e.target.value, node: "", ostemplate: "", storage: "", bridge: "", vmid: 0 })
              }
            >
              <option value="">Host wählen</option>
              {(hosts?.hosts ?? []).map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name}
                </option>
              ))}
            </select>
          </label>
          {(options?.nodes.length ?? 0) > 1 ? (
            <label className="text-sm">
              Node
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
            label="CT-ID"
            value={form.vmid ? String(form.vmid) : ""}
            onChange={(v) => setForm({ ...form, vmid: Number(v) || 0 })}
          />
          <Field label="Hostname" value={form.hostname} onChange={(hostname) => setForm({ ...form, hostname })} />
          <Field
            label="Passwort"
            type="password"
            value={form.password}
            onChange={(password) => setForm({ ...form, password })}
          />
          <label className="text-sm md:col-span-2">
            Template
            <select
              className={selectClass}
              value={form.ostemplate}
              onChange={(e) => setForm({ ...form, ostemplate: e.target.value })}
              disabled={!form.hostId}
            >
              <option value="">{templates.length ? "Template wählen" : "Kein Template gefunden"}</option>
              {templates.map((volid) => (
                <option key={volid} value={volid}>
                  {volid.split("/").pop() ?? volid}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            Storage
            <select
              className={selectClass}
              value={form.storage}
              onChange={(e) => setForm({ ...form, storage: e.target.value })}
              disabled={!form.hostId}
            >
              {(rootStores.length ? rootStores : (options?.storage ?? [])).map((s) => (
                <option key={s.storage} value={s.storage}>
                  {s.storage}
                </option>
              ))}
            </select>
          </label>
          <Field label="Disk (GiB)" value={form.diskSize} onChange={(diskSize) => setForm({ ...form, diskSize })} />
          <Field label="Kerne" value={String(form.cores)} onChange={(v) => setForm({ ...form, cores: Number(v) || 1 })} />
          <Field label="RAM (MiB)" value={String(form.memory)} onChange={(v) => setForm({ ...form, memory: Number(v) || 512 })} />
          <label className="text-sm">
            Bridge
            <select
              className={selectClass}
              value={form.bridge}
              onChange={(e) => setForm({ ...form, bridge: e.target.value })}
              disabled={!form.hostId}
            >
              {(bridges.length ? bridges : ["vmbr0"]).map((iface) => (
                <option key={iface} value={iface}>
                  {iface}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            IPv4
            <select
              className={selectClass}
              value={form.ipMode}
              onChange={(e) => setForm({ ...form, ipMode: e.target.value as LxcIpMode })}
            >
              <option value="dhcp">DHCP</option>
              <option value="static">Statisch</option>
            </select>
          </label>
          {form.ipMode === "static" ? (
            <>
              <Field
                label="Adresse"
                value={form.cidr}
                onChange={(cidr) => setForm({ ...form, cidr })}
                placeholder="192.168.1.50/24"
              />
              <Field
                label="Gateway"
                value={form.gateway}
                onChange={(gateway) => setForm({ ...form, gateway })}
                placeholder="192.168.1.1"
              />
            </>
          ) : null}
          <div className="md:col-span-2">
            <Button onClick={() => create.mutate()} disabled={create.isPending || !canSubmit}>
              {create.isPending ? "Erstelle…" : "Container erstellen"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      <Input type={type} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}
