"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";
import { api } from "@/lib/api";
import type { PublicHost } from "@/lib/types";
import { PageHeader } from "@/components/layout/page-header";
import { CreateIpFields, ipCollision, ipFieldsFromVmid } from "@/components/guests/create-ip-fields";
import { CreateProgressDialog } from "@/components/guests/create-progress-dialog";
import { DEFAULT_GUEST_NETWORK, type GuestIpNetwork } from "@/lib/create-ip";
import type { LxcIpMode } from "@/lib/lxc-net";
import { useI18n } from "@/components/i18n/locale-provider";

type Options = {
  nodes: Array<{ node: string }>;
  nextid: number | null;
  storage: Array<{ storage: string; content?: string }>;
  templates: Array<{ volid?: string }>;
  bridges: Array<{ iface?: string; type?: string }>;
  networks?: GuestIpNetwork[];
  usedIps?: string[];
};

const selectClass =
  "mt-1 h-9 w-full rounded-[4px] border border-input bg-white/[0.03] px-2 text-sm";

export default function CreateLxcPage() {
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
    hostname: "",
    password: "",
    ostemplate: "",
    storage: "",
    diskSize: "8",
    cores: 2,
    memory: 1024,
    bridge: "",
    ipMode: "static" as LxcIpMode,
    network: DEFAULT_GUEST_NETWORK,
    cidr: "",
    gateway: "",
    startAfter: true,
  });
  const [progress, setProgress] = useState<"idle" | "running" | "done" | "error">("idle");
  const [progressError, setProgressError] = useState<string | null>(null);
  const createdRef = useRef<{ hostId: string; node: string; vmid: number } | null>(null);

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
  const networks = options?.networks ?? [];
  const usedIps = options?.usedIps ?? [];

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
      const netList = options.networks?.length ? options.networks : undefined;
      const network =
        f.network && netList?.some((n) => n.id === f.network) ? f.network : (netList?.[0]?.id ?? f.network ?? DEFAULT_GUEST_NETWORK);
      const ip =
        f.ipMode === "static" && !f.cidr.trim()
          ? ipFieldsFromVmid(network, vmid, netList)
          : {};
      return { ...f, node, storage, bridge, ostemplate, vmid, network, ...ip };
    });
  }, [options]);

  const create = useMutation({
    mutationFn: () => {
      const node = form.node || options?.nodes[0]?.node || "";
      const vmid = form.vmid || options?.nextid || 0;
      return api<{ node?: string; vmid?: number; startError?: string }>(`/api/hosts/${form.hostId}/lxc`, {
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
          startAfter: form.startAfter,
        }),
      });
    },
    onMutate: () => {
      setProgressError(null);
      setProgress("running");
    },
    onSuccess: (res) => {
      const node = res.node || form.node || options?.nodes[0]?.node || "";
      const vmid = res.vmid || form.vmid || options?.nextid || 0;
      createdRef.current = { hostId: form.hostId, node, vmid };
      if (res.startError) toast.error(t("create.startFailed", { error: res.startError }));
      else toast.success(t("lxc.created"));
      setProgress("done");
    },
    onError: (e: Error) => {
      setProgressError(e.message);
      setProgress("error");
    },
  });

  useEffect(() => {
    if (progress !== "done" || !createdRef.current) return;
    const target = createdRef.current;
    const timer = window.setTimeout(() => {
      router.push(`/containers/${target.hostId}/${target.node}/${target.vmid}`);
    }, 800);
    return () => window.clearTimeout(timer);
  }, [progress, router]);

  const canSubmit =
    Boolean(form.hostId) &&
    Boolean(form.node || options?.nodes[0]?.node) &&
    (form.vmid > 0 || Boolean(options?.nextid)) &&
    form.hostname.trim().length > 0 &&
    form.password.length >= 5 &&
    Boolean(form.ostemplate) &&
    Boolean(form.storage) &&
    Boolean(form.bridge) &&
    (form.ipMode === "dhcp" || (form.cidr.trim().length > 0 && form.gateway.trim().length > 0)) &&
    !(form.ipMode === "static" && ipCollision(form.cidr, usedIps));

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <PageHeader kicker={t("lxc.kicker")} title={t("lxc.create")} />
      <Card>
        <CardContent className="grid gap-3 pt-5 md:grid-cols-2">
          <label className="text-sm md:col-span-2">
            {t("create.host")}
            <select
              className={selectClass}
              value={form.hostId}
              onChange={(e) =>
                setForm({ ...form, hostId: e.target.value, node: "", ostemplate: "", storage: "", bridge: "", vmid: 0 })
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
                ...(form.ipMode === "static" ? ipFieldsFromVmid(form.network, vmid, networks) : {}),
              });
            }}
          />
          <Field label={t("create.hostname")} value={form.hostname} onChange={(hostname) => setForm({ ...form, hostname })} />
          <Field
            label={t("create.password")}
            type="password"
            value={form.password}
            onChange={(password) => setForm({ ...form, password })}
          />
          <label className="text-sm md:col-span-2">
            {t("create.template")}
            <select
              className={selectClass}
              value={form.ostemplate}
              onChange={(e) => setForm({ ...form, ostemplate: e.target.value })}
              disabled={!form.hostId}
            >
              <option value="">{templates.length ? t("common.chooseTemplate") : t("common.noTemplate")}</option>
              {templates.map((volid) => (
                <option key={volid} value={volid}>
                  {volid.split("/").pop() ?? volid}
                </option>
              ))}
            </select>
            {form.hostId && !templates.length ? (
              <p className="mt-1 text-sm text-muted-foreground">
                {t("create.noTemplateHint")}{" "}
                <Link className="text-primary underline-offset-4 hover:underline" href={`/templates?host=${form.hostId}&tab=lxc`}>
                  {t("create.openTemplates")}
                </Link>
              </p>
            ) : null}
          </label>
          <label className="text-sm">
            {t("create.storage")}
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
          <Field label={t("create.disk")} value={form.diskSize} onChange={(diskSize) => setForm({ ...form, diskSize })} />
          <Field label={t("create.cores")} value={String(form.cores)} onChange={(v) => setForm({ ...form, cores: Number(v) || 1 })} />
          <Field label={t("create.memory")} value={String(form.memory)} onChange={(v) => setForm({ ...form, memory: Number(v) || 512 })} />
          <label className="text-sm">
            {t("create.bridge")}
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
          <CreateIpFields
            value={{ ipMode: form.ipMode, network: form.network, cidr: form.cidr, gateway: form.gateway }}
            vmid={form.vmid}
            networks={networks}
            usedIps={usedIps}
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
              {create.isPending ? t("create.creating") : t("create.submitLxc")}
            </Button>
          </div>
        </CardContent>
      </Card>
      <CreateProgressDialog
        open={progress !== "idle"}
        locked={progress === "running"}
        finished={progress === "done"}
        error={progressError}
        title={t("create.progressLxc")}
        detail={form.hostname.trim() || t("create.progressLxc")}
        onClose={() => {
          if (progress === "running") return;
          setProgress("idle");
          setProgressError(null);
        }}
      />
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
