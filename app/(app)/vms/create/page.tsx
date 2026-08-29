"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { useState, useEffect, useMemo, useRef } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import Link from "next/link";
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
import { bytesToSize } from "@/lib/utils";
import { isWindowsIso, suggestVirtioIso } from "@/lib/iso-images";
import { storageIsIscsi, vmDiskStorages, VM_DISK_BUSES, VM_SCSI_CONTROLLERS } from "@/lib/vm-storage";
import { useI18n } from "@/components/i18n/locale-provider";
import type { StorageContentItem } from "@/lib/storage-content";
import type { MessageKey } from "@/lib/i18n/messages";

type Options = {
  nodes: Array<{ node: string }>;
  nextid: number | null;
  storage: Array<{
    storage: string;
    type?: string;
    content?: string;
    active?: number;
    enabled?: number;
    avail?: number;
    total?: number;
  }>;
  isos: Array<{ volid?: string }>;
  bridges: Array<{ iface?: string }>;
  networks?: GuestIpNetwork[];
  usedIps?: string[];
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
    iso2: "",
    diskStorage: "",
    diskSize: "32",
    diskVolume: "",
    diskBus: "scsi" as "scsi" | "virtio" | "sata",
    scsihw: "virtio-scsi-single" as "virtio-scsi-single" | "virtio-scsi",
    cores: 2,
    memory: 2048,
    bridge: "",
    ipMode: "static" as LxcIpMode,
    network: DEFAULT_GUEST_NETWORK,
    cidr: "",
    gateway: "",
    startAfter: true,
    cloudInit: true,
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

  const imageStores = useMemo(() => vmDiskStorages(options?.storage ?? []), [options]);
  const isos = useMemo(
    () => (options?.isos ?? []).map((i) => String(i.volid ?? "")).filter(Boolean),
    [options],
  );
  const bridges = useMemo(
    () => (options?.bridges ?? []).map((b) => String(b.iface ?? "")).filter(Boolean),
    [options],
  );
  const networks = options?.networks ?? [];
  const usedIps = options?.usedIps ?? [];
  const selectedStore = imageStores.find((s) => s.storage === form.diskStorage);
  const iscsi = selectedStore ? storageIsIscsi(selectedStore) : false;
  const node = form.node || options?.nodes[0]?.node || "";
  const { data: lunData } = useQuery({
    queryKey: ["vm-disk-luns", form.hostId, node, form.diskStorage],
    enabled: Boolean(form.hostId && node && form.diskStorage && iscsi),
    queryFn: () =>
      api<{ items: StorageContentItem[] }>(
        `/api/hosts/${form.hostId}/storage/content?node=${encodeURIComponent(node)}&storage=${encodeURIComponent(form.diskStorage)}`,
      ),
    retry: false,
  });
  const luns = lunData?.items ?? [];

  useEffect(() => {
    if (!options) return;
    setForm((f) => {
      const node =
        f.node && options.nodes.some((n) => n.node === f.node) ? f.node : (options.nodes[0]?.node ?? "");
      const stores = vmDiskStorages(options.storage ?? []);
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
      const iso2 = f.iso2 && isoList.includes(f.iso2) && f.iso2 !== iso ? f.iso2 : "";
      const netList = options.networks?.length ? options.networks : undefined;
      const network =
        f.network && netList?.some((n) => n.id === f.network) ? f.network : (netList?.[0]?.id ?? f.network ?? DEFAULT_GUEST_NETWORK);
      const ip =
        f.ipMode === "static" && !f.cidr.trim()
          ? ipFieldsFromVmid(network, vmid, netList)
          : {};
      const cloudInit = iso ? false : f.cloudInit;
      return { ...f, node, diskStorage, bridge, vmid, iso, iso2, network, cloudInit, ...ip };
    });
  }, [options]);

  const create = useMutation({
    mutationFn: () => {
      const node = form.node || options?.nodes[0]?.node || "";
      const vmid = form.vmid || options?.nextid || 0;
      return api<{ node?: string; vmid?: number; startError?: string }>(`/api/hosts/${form.hostId}/vms`, {
        method: "POST",
        body: JSON.stringify({
          node,
          vmid,
          name: form.name.trim(),
          iso: form.iso || undefined,
          iso2: form.iso2 || undefined,
          diskStorage: form.diskStorage,
          diskSize: form.diskVolume ? undefined : String(Number(form.diskSize) || 32),
          diskVolume: form.diskVolume || undefined,
          diskBus: form.diskBus,
          scsihw: form.scsihw,
          cores: form.cores,
          memory: form.memory,
          bridge: form.bridge,
          startAfter: form.startAfter,
          discard: true,
          ssd: true,
          ipv4: form.ipMode === "dhcp" ? "dhcp" : form.cidr,
          gateway: form.ipMode === "static" ? form.gateway : undefined,
          cloudInit: form.ipMode === "static" && form.cloudInit && !iscsi,
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
      else toast.success(t("vms.created"));
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
      router.push(`/vms/${target.hostId}/${target.node}/${target.vmid}`);
    }, 800);
    return () => window.clearTimeout(timer);
  }, [progress, router]);

  const canSubmit =
    Boolean(form.hostId) &&
    Boolean(form.node || options?.nodes[0]?.node) &&
    (form.vmid > 0 || Boolean(options?.nextid)) &&
    form.name.trim().length > 0 &&
    Boolean(form.diskStorage) &&
    (iscsi ? Boolean(form.diskVolume) || Number(form.diskSize) > 0 : Number(form.diskSize) > 0) &&
    Boolean(form.bridge) &&
    (form.ipMode === "dhcp" || (form.cidr.trim().length > 0 && form.gateway.trim().length > 0)) &&
    !(form.ipMode === "static" && ipCollision(form.cidr, usedIps));

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
                setForm({ ...form, hostId: e.target.value, node: "", iso: "", iso2: "", diskStorage: "", diskVolume: "", bridge: "", vmid: 0 })
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
          <Field label={t("create.name")} value={form.name} onChange={(name) => setForm({ ...form, name })} />
          <label className="text-sm md:col-span-2">
            {t("create.iso")}
            <select
              className={selectClass}
              value={form.iso}
              onChange={(e) => {
                const iso = e.target.value;
                const iso2 =
                  iso && isWindowsIso(iso)
                    ? form.iso2 && form.iso2 !== iso
                      ? form.iso2
                      : suggestVirtioIso(isos, iso)
                    : form.iso2 === iso
                      ? ""
                      : form.iso2;
                setForm({
                  ...form,
                  iso,
                  iso2,
                  cloudInit: iso ? false : true,
                });
              }}
            >
              <option value="">{t("common.none")}</option>
              {isos.map((volid) => (
                <option key={volid} value={volid}>
                  {volid.split("/").pop() ?? volid}
                </option>
              ))}
            </select>
            {form.hostId && !isos.length ? (
              <p className="mt-1 text-sm text-muted-foreground">
                {t("create.noIsoHint")}{" "}
                <Link className="text-primary underline-offset-4 hover:underline" href={`/templates?host=${form.hostId}&tab=iso`}>
                  {t("create.openIsos")}
                </Link>
              </p>
            ) : null}
          </label>
          <label className="text-sm md:col-span-2">
            {t("create.iso2")}
            <select
              className={selectClass}
              value={form.iso2}
              onChange={(e) => setForm({ ...form, iso2: e.target.value })}
            >
              <option value="">{t("common.none")}</option>
              {isos
                .filter((volid) => volid !== form.iso)
                .map((volid) => (
                  <option key={volid} value={volid}>
                    {volid.split("/").pop() ?? volid}
                  </option>
                ))}
            </select>
            {form.iso && isWindowsIso(form.iso) ? (
              <p className="mt-1 text-sm text-muted-foreground">{t("create.iso2Hint")}</p>
            ) : null}
          </label>
          <label className="text-sm md:col-span-2">
            {t("create.storage")}
            <select
              className={selectClass}
              value={form.diskStorage}
              onChange={(e) => setForm({ ...form, diskStorage: e.target.value, diskVolume: "" })}
            >
              {(imageStores.length ? imageStores : (options?.storage ?? [])).map((s) => (
                <option key={s.storage} value={s.storage}>
                  {[s.storage, s.type, s.avail != null ? `${bytesToSize(s.avail)} ${t("create.storageFree")}` : ""]
                    .filter(Boolean)
                    .join(" · ")}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            {t("create.scsihw")}
            <select
              className={selectClass}
              value={form.scsihw}
              onChange={(e) => setForm({ ...form, scsihw: e.target.value as typeof form.scsihw })}
            >
              {VM_SCSI_CONTROLLERS.map((item) => (
                <option key={item.id} value={item.id}>
                  {t(item.labelKey as MessageKey)}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            {t("create.diskBus")}
            <select
              className={selectClass}
              value={form.diskBus}
              onChange={(e) => setForm({ ...form, diskBus: e.target.value as typeof form.diskBus })}
            >
              {VM_DISK_BUSES.map((bus) => (
                <option key={bus} value={bus}>
                  {t(
                    bus === "scsi"
                      ? "create.diskBusScsi"
                      : bus === "virtio"
                        ? "create.diskBusVirtio"
                        : "create.diskBusSata",
                  )}
                </option>
              ))}
            </select>
          </label>
          {iscsi ? (
            <label className="text-sm md:col-span-2">
              {t("create.lun")}
              <select
                className={selectClass}
                value={form.diskVolume}
                onChange={(e) => setForm({ ...form, diskVolume: e.target.value })}
              >
                <option value="">{t("common.none")}</option>
                {luns.map((item) => (
                  <option key={item.volid} value={item.volid}>
                    {item.filename || item.volid}
                    {item.size ? ` · ${bytesToSize(item.size)}` : ""}
                  </option>
                ))}
              </select>
              {!luns.length ? <p className="mt-1 text-sm text-muted-foreground">{t("create.lunEmpty")}</p> : null}
            </label>
          ) : (
            <Field label={t("create.disk")} value={form.diskSize} onChange={(diskSize) => setForm({ ...form, diskSize })} />
          )}
          {!iscsi || form.diskVolume ? null : (
            <Field label={t("create.disk")} value={form.diskSize} onChange={(diskSize) => setForm({ ...form, diskSize })} />
          )}
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
            networks={networks}
            usedIps={usedIps}
            hint={form.iso && form.ipMode === "static" && !form.cloudInit ? t("create.isoIpHint") : undefined}
            onChange={(ip) => setForm({ ...form, ...ip })}
          />
          {form.ipMode === "static" && !iscsi ? (
            <label className="flex items-center gap-2 text-sm md:col-span-2">
              <input
                type="checkbox"
                checked={form.cloudInit}
                onChange={(e) => setForm({ ...form, cloudInit: e.target.checked })}
              />
              {t("create.cloudInit")}
            </label>
          ) : null}
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
      <CreateProgressDialog
        open={progress !== "idle"}
        locked={progress === "running"}
        finished={progress === "done"}
        error={progressError}
        title={t("create.progressVm")}
        detail={form.name.trim() || t("create.progressVm")}
        onClose={() => {
          if (progress === "running") return;
          setProgress("idle");
          setProgressError(null);
        }}
      />
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
