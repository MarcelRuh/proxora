"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useState, useEffect, useMemo, useRef } from "react";
import { toast } from "sonner";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";
import { api } from "@/lib/api";
import type { PublicHost } from "@/lib/types";
import { PageHeader } from "@/components/layout/page-header";
import { CreateProgressDialog } from "@/components/guests/create-progress-dialog";
import { invalidateDashboardQueries } from "@/components/dashboard/use-dashboard";
import { bytesToSize } from "@/lib/utils";
import {
  hasUsableVirtioIso,
  isWindowsIso,
  isoVolid,
  needsVirtioDownload as virtioDownloadNeeded,
  suggestVirtioIso,
  VIRTIO_WIN_CATALOG_ITEM,
  type IsoCatalogItem,
} from "@/lib/iso-images";
import { storageIsIscsi, vmDiskStorages, VM_DISK_BUSES, VM_SCSI_CONTROLLERS } from "@/lib/vm-storage";
import { useCreateOptions } from "@/components/guests/use-create-options";
import { MemoryField } from "@/components/guests/memory-field";
import { HostSelect, hostAllowsCreate } from "@/components/guests/host-select";
import { nextAutoVmid } from "@/lib/guest-create-options";
import { visitGuestDetail } from "@/lib/guest-href";
import { isUpid } from "@/lib/guest-task";
import { useCreateTaskFollow } from "@/components/guests/use-create-task";
import { useProxmoxTask } from "@/components/tasks/use-proxmox-task";
import { useI18n } from "@/components/i18n/locale-provider";
import type { StorageContentItem } from "@/lib/storage-content";
import type { MessageKey } from "@/lib/i18n/messages";

const selectClass =
  "mt-1 h-9 w-full rounded-[4px] border border-input bg-white/[0.03] px-2 text-sm";

export default function CreateVmPage() {
  const { t } = useI18n();
  const qc = useQueryClient();
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
    cpu: "" as "" | "host" | "kvm64",
    cores: 2,
    memory: 2048,
    bridge: "",
    startAfter: true,
  });
  const [progress, setProgress] = useState<"idle" | "running" | "done" | "error">("idle");
  const [progressError, setProgressError] = useState<string | null>(null);
  const [createUpid, setCreateUpid] = useState<string | null>(null);
  const [virtioDownload, setVirtioDownload] = useState<{
    upid: string;
    node: string;
    storage: string;
    filename: string;
    status: "running" | "done" | "error";
    error: string | null;
  } | null>(null);
  const [virtioBusy, setVirtioBusy] = useState(false);
  const createdRef = useRef<{ hostId: string; node: string; vmid: number } | null>(null);
  const autoVmidRef = useRef(0);
  const virtioDoneRef = useRef(false);
  const { data: options } = useCreateOptions(form.hostId, "dhcp", form.node);
  const windowsSelected = Boolean(form.iso && isWindowsIso(form.iso));
  const { data: virtioRec } = useQuery({
    queryKey: ["virtio-recommended", form.hostId],
    enabled: Boolean(form.hostId && windowsSelected),
    queryFn: () => api<{ recommendedVirtio: IsoCatalogItem }>(`/api/hosts/${form.hostId}/isos?virtio=1`),
    staleTime: 30 * 60_000,
  });
  const recommendedVirtio = virtioRec?.recommendedVirtio ?? VIRTIO_WIN_CATALOG_ITEM;

  useEffect(() => {
    const creatable = (hosts?.hosts ?? []).filter((host) => hostAllowsCreate(host, "vm"));
    if (!form.hostId && creatable.length === 1 && creatable[0]) {
      setForm((f) => ({ ...f, hostId: creatable[0]!.id }));
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
  const showVirtioDownload = useMemo(
    () => windowsSelected && virtioDownloadNeeded(isos, recommendedVirtio.version),
    [windowsSelected, isos, recommendedVirtio.version],
  );
  const virtioIsUpdate = windowsSelected && hasUsableVirtioIso(isos) && showVirtioDownload;
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
      const vmid = nextAutoVmid(f.vmid, options.nextid ?? 0, autoVmidRef.current);
      const isoList = (options.isos ?? []).map((i) => String(i.volid ?? "")).filter(Boolean);
      const iso = f.iso && isoList.includes(f.iso) ? f.iso : "";
      const keptIso2 = f.iso2 && isoList.includes(f.iso2) && f.iso2 !== iso ? f.iso2 : "";
      const iso2 =
        keptIso2 || (iso && isWindowsIso(iso) ? suggestVirtioIso(isoList, iso) : "");
      const next = { ...f, node, diskStorage, bridge, vmid, iso, iso2 };
      return next.node === f.node &&
        next.diskStorage === f.diskStorage &&
        next.bridge === f.bridge &&
        next.vmid === f.vmid &&
        next.iso === f.iso &&
        next.iso2 === f.iso2
        ? f
        : next;
    });
    autoVmidRef.current = options.nextid ?? 0;
  }, [options]);

  const create = useMutation({
    mutationFn: () => {
      const node = form.node || options?.nodes[0]?.node || "";
      const vmid = form.vmid || options?.nextid || 0;
      return api<{ node?: string; vmid?: number; upid?: unknown }>(`/api/hosts/${form.hostId}/vms`, {
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
          cpu: form.cpu || undefined,
          cores: form.cores,
          memory: form.memory,
          bridge: form.bridge,
          startAfter: form.startAfter,
          discard: true,
          ssd: true,
        }),
      });
    },
    onMutate: () => {
      setProgressError(null);
      setCreateUpid(null);
      setProgress("running");
    },
    onSuccess: (res) => {
      const node = res.node || form.node || options?.nodes[0]?.node || "";
      const vmid = res.vmid || form.vmid || options?.nextid || 0;
      createdRef.current = { hostId: form.hostId, node, vmid };
      const upid = isUpid(res.upid) ? res.upid : null;
      if (!upid) {
        setProgressError(t("common.failed"));
        setProgress("error");
        return;
      }
      void invalidateDashboardQueries(qc);
      setCreateUpid(upid);
    },
    onError: (e: Error) => {
      setProgressError(e.message);
      setProgress("error");
    },
  });

  const progressRef = useRef(progress);
  progressRef.current = progress;

  const virtioTask = useProxmoxTask({
    hostId: form.hostId,
    node: virtioDownload?.node ?? "",
    upid: virtioDownload?.upid ?? null,
    open: Boolean(virtioDownload && virtioDownload.status === "running"),
    failedFallback: t("iso.downloadFailed"),
  });

  useEffect(() => {
    if (!virtioDownload || virtioDownload.status !== "running") return;
    if (virtioTask.errorMsg) {
      setVirtioDownload((cur) => (cur ? { ...cur, status: "error", error: virtioTask.errorMsg } : cur));
      setVirtioBusy(false);
      return;
    }
    if (!virtioTask.finished || virtioDoneRef.current) return;
    virtioDoneRef.current = true;
    const expected = isoVolid(virtioDownload.storage, virtioDownload.filename);
    setForm((f) => ({ ...f, iso2: expected }));
    setVirtioDownload((cur) => (cur ? { ...cur, status: "done", error: null } : cur));
    setVirtioBusy(false);
    toast.success(t("iso.downloadDone"));
    void qc.invalidateQueries({ queryKey: ["options-media", form.hostId] });
    void qc.invalidateQueries({ queryKey: ["options", form.hostId] });
    void qc.invalidateQueries({ queryKey: ["iso-images", form.hostId] });
    void qc.invalidateQueries({ queryKey: ["virtio-recommended", form.hostId] });
  }, [virtioDownload, virtioTask.errorMsg, virtioTask.finished, form.hostId, qc, t]);

  async function downloadVirtioIso() {
    if (!form.hostId || virtioBusy) return;
    setVirtioBusy(true);
    virtioDoneRef.current = false;
    setVirtioDownload(null);
    try {
      const nodeName = form.node || options?.nodes[0]?.node || "";
      const q = nodeName ? `?node=${encodeURIComponent(nodeName)}` : "";
      const catalog = await api<{
        node: string;
        storages: string[];
        recommendedVirtio?: IsoCatalogItem;
      }>(`/api/hosts/${form.hostId}/isos${q}`);
      const storage = catalog.storages[0];
      const item = catalog.recommendedVirtio ?? recommendedVirtio;
      if (!catalog.node || !storage) throw new Error(t("iso.noStorage"));
      const res = await api<{ upid?: string; node?: string }>(`/api/hosts/${form.hostId}/isos`, {
        method: "POST",
        body: JSON.stringify({
          node: catalog.node,
          storage,
          url: item.url,
          filename: item.filename,
        }),
      });
      if (!isUpid(res.upid)) throw new Error(t("common.failed"));
      setVirtioDownload({
        upid: res.upid,
        node: res.node || catalog.node,
        storage,
        filename: item.filename,
        status: "running",
        error: null,
      });
    } catch (e) {
      setVirtioBusy(false);
      toast.error(e instanceof Error ? e.message : t("common.failed"));
    }
  }

  const closeProgress = useCallback(() => {
    if (progressRef.current === "running") return;
    const target = progressRef.current === "done" ? createdRef.current : null;
    setProgress("idle");
    setProgressError(null);
    setCreateUpid(null);
    if (target) {
      window.setTimeout(() => {
        visitGuestDetail("vm", target.hostId, target.node, target.vmid);
      }, 0);
    }
  }, []);

  const created = createdRef.current;
  const follow = useCreateTaskFollow({
    kind: "vm",
    hostId: created?.hostId || form.hostId,
    node: created?.node || form.node,
    vmid: created?.vmid || form.vmid,
    createUpid,
    startAfter: form.startAfter,
    open: progress === "running" && Boolean(createUpid),
    failedFallback: t("common.failed"),
    nudgeCdBoot: Boolean(form.iso && isWindowsIso(form.iso) && form.startAfter),
    onAllDone: () => {
      toast.success(t("vms.created"));
      setProgress("done");
    },
    onFailed: (message) => {
      setProgressError(message);
      setProgress("error");
    },
  });

  useEffect(() => {
    if (progress !== "done") return;
    const timer = window.setTimeout(() => closeProgress(), 800);
    return () => window.clearTimeout(timer);
  }, [progress, closeProgress]);

  const canSubmit =
    Boolean(form.hostId) &&
    Boolean(form.node || options?.nodes[0]?.node) &&
    (form.vmid > 0 || Boolean(options?.nextid)) &&
    form.name.trim().length > 0 &&
    Boolean(form.diskStorage) &&
    (iscsi ? Boolean(form.diskVolume) || Number(form.diskSize) > 0 : Number(form.diskSize) > 0) &&
    Boolean(form.bridge);

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <PageHeader kicker={t("vms.kicker")} title={t("vms.create")} />
      <Card>
        <CardContent className="grid gap-3 pt-5 md:grid-cols-2">
          <label className="text-sm md:col-span-2">
            {t("create.host")}
            <HostSelect
              hosts={hosts?.hosts ?? []}
              value={form.hostId}
              createOnly
              kind="vm"
              onChange={(hostId) => {
                autoVmidRef.current = 0;
                setForm({
                  ...form,
                  hostId,
                  node: "",
                  iso: "",
                  iso2: "",
                  diskStorage: "",
                  diskVolume: "",
                  bridge: "",
                  vmid: 0,
                });
              }}
            />
            {hosts?.hosts.find((h) => h.id === form.hostId)?.origin === "PEER" ? (
              <p className="mt-1 text-xs text-warning">
                {t("peers.createOnPeer", {
                  name: hosts.hosts.find((h) => h.id === form.hostId)?.name ?? "",
                  owner: hosts.hosts.find((h) => h.id === form.hostId)?.peerName ?? "",
                })}
              </p>
            ) : null}
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
            onChange={(v) => setForm({ ...form, vmid: Number(v) || 0 })}
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
                const cpu = iso && isWindowsIso(iso) ? "host" : isWindowsIso(form.iso) ? "" : form.cpu;
                setForm({ ...form, iso, iso2, cpu });
              }}
            >
              <option value="">{t("common.none")}</option>
              {isos.map((volid) => (
                <option key={volid} value={volid}>
                  {volid.split("/").pop() ?? volid}
                </option>
              ))}
            </select>
            {form.iso && isWindowsIso(form.iso) ? (
              <p className="mt-1 text-sm text-muted-foreground">{t("create.windowsHwHint")}</p>
            ) : null}
            {form.hostId && !isos.length ? (
              <p className="mt-1 text-sm text-muted-foreground">
                {t("create.noIsoHint")}{" "}
                <Link className="text-primary underline-offset-4 hover:underline" href={`/templates?host=${encodeURIComponent(form.hostId)}&tab=iso`}>
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
            {showVirtioDownload ? (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={virtioBusy || Boolean(virtioDownload && virtioDownload.status === "running")}
                  onClick={() => void downloadVirtioIso()}
                >
                  {virtioBusy || virtioDownload?.status === "running"
                    ? t("create.virtioDownloading")
                    : t(virtioIsUpdate ? "create.virtioUpdate" : "create.virtioDownload", {
                        version: recommendedVirtio.version,
                      })}
                </Button>
                <span className="text-xs text-muted-foreground">{t("create.virtioDownloadHint")}</span>
              </div>
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
            {t("create.cpu")}
            <select
              className={selectClass}
              value={form.cpu}
              onChange={(e) => setForm({ ...form, cpu: e.target.value as typeof form.cpu })}
            >
              <option value="">{t("create.cpuDefault")}</option>
              <option value="host">{t("create.cpuHost")}</option>
              <option value="kvm64">kvm64</option>
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
          <MemoryField value={form.memory} onChange={(memory) => setForm({ ...form, memory })} />
          <label className="text-sm md:col-span-2">
            {t("create.bridge")}
            <select className={selectClass} value={form.bridge} onChange={(e) => setForm({ ...form, bridge: e.target.value })}>
              {(bridges.length ? bridges : ["vmbr0"]).map((iface) => (
                <option key={iface} value={iface}>
                  {iface}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm md:col-span-2">
            <input
              type="checkbox"
              checked={form.startAfter}
              onChange={(e) => setForm({ ...form, startAfter: e.target.checked })}
            />
            {t("create.startAfter")}
          </label>
          <div className="md:col-span-2">
            <Button onClick={() => create.mutate()} disabled={create.isPending || progress === "running" || !canSubmit}>
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
        title={follow.phase === "start" ? t("create.progressStartVm") : t("create.progressVm")}
        detail={form.name.trim() || t("create.progressVm")}
        lines={follow.logLines}
        onClose={closeProgress}
      />
      <CreateProgressDialog
        open={Boolean(virtioDownload)}
        locked={virtioDownload?.status === "running"}
        finished={virtioDownload?.status === "done"}
        error={virtioDownload?.error ?? null}
        title={t("create.virtioDownloadTitle")}
        detail={virtioDownload?.filename ?? recommendedVirtio.filename}
        lines={virtioTask.logLines}
        onClose={() => {
          if (virtioDownload?.status === "running") return;
          setVirtioDownload(null);
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
