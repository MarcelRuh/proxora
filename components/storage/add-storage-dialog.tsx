"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Loader2, Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input, Label } from "@/components/ui/input";
import { SELECT_CLASS } from "@/components/backups/types";
import { useI18n } from "@/components/i18n/locale-provider";
import { useCan } from "@/components/auth/session-user";
import { api } from "@/lib/api";
import { peerHostAllowsPermission } from "@/lib/federation-access";
import type { MessageKey } from "@/lib/i18n/messages";
import type { PublicHost } from "@/lib/types";
import {
  STORAGE_CREATE_TYPES,
  STORAGE_ID_PATTERN,
  STORAGE_SCAN_KIND,
  STORAGE_TYPE_CONTENT,
  STORAGE_TYPE_DEFAULT_CONTENT,
  type StorageContentOption,
  type StorageCreateType,
  type StorageScanOption,
} from "@/lib/storage-create";
import { cn } from "@/lib/utils";

type Form = {
  type: StorageCreateType;
  storage: string;
  content: StorageContentOption[];
  nodes: string[];
  disable: boolean;
  path: string;
  shared: boolean;
  server: string;
  export: string;
  nfsVersion: "" | "3" | "4" | "4.1" | "4.2";
  share: string;
  username: string;
  password: string;
  domain: string;
  subdir: string;
  smbVersion: "default" | "2.0" | "2.1" | "3" | "3.0" | "3.11";
  port: string;
  datastore: string;
  fingerprint: string;
  namespace: string;
  vgname: string;
  thinpool: string;
  pool: string;
  sparse: boolean;
};

function emptyForm(type: StorageCreateType = "nfs"): Form {
  return {
    type,
    storage: "",
    content: [...STORAGE_TYPE_DEFAULT_CONTENT[type]],
    nodes: [],
    disable: false,
    path: "",
    shared: false,
    server: "",
    export: "",
    nfsVersion: "",
    share: "",
    username: "",
    password: "",
    domain: "",
    subdir: "",
    smbVersion: "default",
    port: "",
    datastore: "",
    fingerprint: "",
    namespace: "",
    vgname: "",
    thinpool: "",
    pool: "",
    sparse: true,
  };
}

/** JSON body for POST /api/hosts/:id/storage (validated again server-side). */
function payload(form: Form): Record<string, unknown> {
  const base = {
    type: form.type,
    storage: form.storage.trim(),
    content: form.content,
    nodes: form.nodes.length ? form.nodes : undefined,
    disable: form.disable || undefined,
  };
  switch (form.type) {
    case "dir":
      return { ...base, path: form.path.trim(), shared: form.shared };
    case "nfs":
      return { ...base, server: form.server.trim(), export: form.export.trim(), nfsVersion: form.nfsVersion || undefined };
    case "cifs":
      return {
        ...base,
        server: form.server.trim(),
        share: form.share.trim(),
        username: form.username.trim() || undefined,
        password: form.username.trim() ? form.password || undefined : undefined,
        domain: form.domain.trim() || undefined,
        subdir: form.subdir.trim() || undefined,
        smbVersion: form.smbVersion,
      };
    case "pbs":
      return {
        ...base,
        server: form.server.trim(),
        port: form.port ? Number(form.port) : undefined,
        datastore: form.datastore.trim(),
        username: form.username.trim(),
        password: form.password,
        fingerprint: form.fingerprint.trim() || undefined,
        namespace: form.namespace.trim() || undefined,
      };
    case "lvm":
      return { ...base, vgname: form.vgname.trim(), shared: form.shared };
    case "lvmthin":
      return { ...base, vgname: form.vgname.trim(), thinpool: form.thinpool.trim() };
    case "zfspool":
      return { ...base, pool: form.pool.trim(), sparse: form.sparse };
  }
}

function missingRequired(form: Form): boolean {
  if (!form.storage.trim() || form.content.length === 0) return true;
  switch (form.type) {
    case "dir":
      return !form.path.trim();
    case "nfs":
      return !form.server.trim() || !form.export.trim();
    case "cifs":
      return !form.server.trim() || !form.share.trim();
    case "pbs":
      return !form.server.trim() || !form.datastore.trim() || !form.username.trim() || !form.password;
    case "lvm":
      return !form.vgname.trim();
    case "lvmthin":
      return !form.vgname.trim() || !form.thinpool.trim();
    case "zfspool":
      return !form.pool.trim();
  }
}

/** Which field a scan fills, and what the scan needs first. */
function scanTarget(form: Form): { field: keyof Form; ready: boolean } | null {
  switch (form.type) {
    case "nfs":
      return { field: "export", ready: Boolean(form.server.trim()) };
    case "cifs":
      return { field: "share", ready: Boolean(form.server.trim()) };
    case "pbs":
      return { field: "datastore", ready: Boolean(form.server.trim() && form.username.trim() && form.password) };
    case "lvm":
      return { field: "vgname", ready: true };
    case "lvmthin":
      return { field: "thinpool", ready: Boolean(form.vgname.trim()) };
    case "zfspool":
      return { field: "pool", ready: true };
    default:
      return null;
  }
}

function scanBody(form: Form, node: string): Record<string, unknown> | null {
  const kind = STORAGE_SCAN_KIND[form.type];
  if (!kind) return null;
  switch (kind) {
    case "nfs":
      return { kind, node, server: form.server.trim() };
    case "cifs":
      return {
        kind,
        node,
        server: form.server.trim(),
        username: form.username.trim() || undefined,
        password: form.username.trim() ? form.password || undefined : undefined,
        domain: form.domain.trim() || undefined,
      };
    case "pbs":
      return {
        kind,
        node,
        server: form.server.trim(),
        port: form.port ? Number(form.port) : undefined,
        username: form.username.trim(),
        password: form.password,
        fingerprint: form.fingerprint.trim() || undefined,
      };
    case "lvmthin":
      return { kind, node, vg: form.vgname.trim() };
    default:
      return { kind, node };
  }
}

function Field({
  id,
  label,
  hint,
  error,
  required,
  children,
  className,
}: {
  id?: string;
  label: string;
  hint?: string;
  error?: string | null;
  required?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={id}>
        {label}
        {required ? <span className="text-primary"> *</span> : null}
      </Label>
      {children}
      {error || hint ? (
        <p
          id={id ? `${id}-hint` : undefined}
          role={error ? "alert" : undefined}
          className={cn("text-[11px]", error ? "text-destructive" : "text-muted-foreground")}
        >
          {error || hint}
        </p>
      ) : null}
    </div>
  );
}

export function AddStorageButton({
  host,
  nodes,
  existing,
  onDone,
}: {
  host: PublicHost;
  nodes: string[];
  existing: string[];
  onDone: () => void;
}) {
  const { t } = useI18n();
  const can = useCan("storage.config", host.id);
  const [open, setOpen] = useState(false);
  if (!can || !peerHostAllowsPermission(host, "storage.config")) return null;
  const online = host.connectionState === "ONLINE";
  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="gap-1"
        disabled={!online}
        title={online ? undefined : t("storage.add.offline")}
        onClick={() => setOpen(true)}
      >
        <Plus className="h-3.5 w-3.5" />
        {t("storage.add.button")}
      </Button>
      {open ? (
        <AddStorageDialog
          hostId={host.id}
          hostName={host.name}
          nodes={nodes}
          existing={existing}
          onOpenChange={setOpen}
          onDone={onDone}
        />
      ) : null}
    </>
  );
}

function AddStorageDialog({
  hostId,
  hostName,
  nodes,
  existing,
  onOpenChange,
  onDone,
}: {
  hostId: string;
  hostName: string;
  nodes: string[];
  existing: string[];
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const [form, setForm] = useState<Form>(() => emptyForm());
  const [busy, setBusy] = useState(false);
  const [scanNode, setScanNode] = useState(nodes[0] ?? "");
  const [scanning, setScanning] = useState(false);
  const [options, setOptions] = useState<StorageScanOption[] | null>(null);
  const idTaken = useMemo(
    () => existing.some((name) => name.toLowerCase() === form.storage.trim().toLowerCase()),
    [existing, form.storage],
  );
  const idValue = form.storage.trim();
  const idInvalid = idValue.length > 0 && (idValue.length > 64 || !STORAGE_ID_PATTERN.test(idValue));
  const idError = idTaken ? t("storage.add.idTaken") : idInvalid ? t("storage.add.idInvalid") : null;
  const target = scanTarget(form);
  const isLocal = form.type === "dir" || form.type === "lvm" || form.type === "lvmthin" || form.type === "zfspool";

  function set<K extends keyof Form>(key: K, value: Form[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
    // Scan results depend on server / credentials / VG: drop them when those change.
    if (["server", "username", "password", "domain", "port", "fingerprint", "vgname"].includes(key)) setOptions(null);
  }

  function setType(type: StorageCreateType) {
    setForm((prev) => ({
      ...emptyForm(type),
      storage: prev.storage,
      nodes: prev.nodes,
      disable: prev.disable,
      // Keep connection details when switching between network types.
      server: prev.server,
      username: type === "pbs" || type === "cifs" ? prev.username : "",
    }));
    setOptions(null);
  }

  function toggleContent(item: StorageContentOption) {
    setForm((prev) => ({
      ...prev,
      content: prev.content.includes(item) ? prev.content.filter((c) => c !== item) : [...prev.content, item],
    }));
  }

  function toggleNode(node: string) {
    setForm((prev) => ({
      ...prev,
      nodes: prev.nodes.includes(node) ? prev.nodes.filter((n) => n !== node) : [...prev.nodes, node],
    }));
  }

  async function runScan() {
    const body = scanBody(form, scanNode);
    if (!body || !scanNode) return;
    setScanning(true);
    try {
      const res = await api<{ options: StorageScanOption[] }>(`/api/hosts/${hostId}/storage/scan`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      setOptions(res.options);
      if (res.options.length === 0) toast.message(t("storage.add.scanEmpty"));
      else if (target && !String(form[target.field] ?? "").trim()) set(target.field, res.options[0].value as never);
    } catch (e) {
      setOptions(null);
      toast.error(e instanceof Error ? e.message : t("storage.add.scanFailed"));
    } finally {
      setScanning(false);
    }
  }

  async function submit() {
    if (missingRequired(form) || idError) return;
    setBusy(true);
    try {
      await api(`/api/hosts/${hostId}/storage`, { method: "POST", body: JSON.stringify(payload(form)) });
      toast.success(t("storage.add.done", { name: form.storage.trim() }));
      onOpenChange(false);
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.failed"));
    } finally {
      setBusy(false);
    }
  }

  const scanControl = target ? (
    <div className="flex flex-wrap items-center gap-2">
      {nodes.length > 1 && isLocal ? (
        <select
          aria-label={t("storage.add.scanNode")}
          className={cn(SELECT_CLASS, "mt-0 h-8 w-auto")}
          value={scanNode}
          onChange={(e) => {
            setScanNode(e.target.value);
            setOptions(null);
          }}
        >
          {nodes.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      ) : null}
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="gap-1"
        disabled={!target.ready || scanning || !scanNode}
        onClick={() => void runScan()}
      >
        {scanning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
        {t("storage.add.scan")}
      </Button>
      {!target.ready ? <span className="text-[11px] text-muted-foreground">{t(`storage.add.scanNeeds.${form.type}` as MessageKey)}</span> : null}
    </div>
  ) : null;

  /** Text input that turns into a picker once a scan returned results. */
  function scanned(field: "export" | "share" | "datastore" | "vgname" | "thinpool" | "pool", placeholder: string) {
    const list = target?.field === field ? options : null;
    const id = `sf-${field}`;
    if (list && list.length) {
      return (
        <select id={id} className={cn(SELECT_CLASS, "mt-0")} value={form[field]} onChange={(e) => set(field, e.target.value)}>
          {list.some((o) => o.value === form[field]) ? null : <option value={form[field]}>{form[field] || "—"}</option>}
          {list.map((o) => (
            <option key={o.value} value={o.value}>
              {o.detail ? `${o.label} — ${o.detail}` : o.label}
            </option>
          ))}
        </select>
      );
    }
    return <Input id={id} value={form[field]} placeholder={placeholder} onChange={(e) => set(field, e.target.value)} />;
  }

  const invalid = missingRequired(form) || Boolean(idError);

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("storage.add.title", { host: hostName })}</DialogTitle>
          <DialogDescription>{t("storage.add.description")}</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <div role="radiogroup" aria-label={t("table.type")} className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
            {STORAGE_CREATE_TYPES.map((type) => (
              <button
                key={type}
                type="button"
                role="radio"
                aria-checked={form.type === type}
                onClick={() => setType(type)}
                className={cn(
                  "rounded-[var(--ui-radius)] border px-2.5 py-2 text-left text-xs transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  form.type === type
                    ? "border-primary bg-primary/10 text-foreground"
                    : "border-border text-muted-foreground hover:border-primary/50 hover:text-foreground",
                )}
              >
                <span className="block font-medium">{t(`storage.add.type.${type}` as MessageKey)}</span>
                <span className="block text-[10px] opacity-80">{t(`storage.add.typeHint.${type}` as MessageKey)}</span>
              </button>
            ))}
          </div>

          <Field
            id="sf-storage"
            label={t("storage.add.id")}
            hint={t("storage.add.idHint")}
            error={idError}
            required
          >
            <Input
              id="sf-storage"
              aria-describedby="sf-storage-hint"
              value={form.storage}
              autoFocus
              placeholder={form.type === "pbs" ? "pbs-backup" : form.type === "nfs" ? "nas-nfs" : "data"}
              aria-invalid={idError ? true : undefined}
              onChange={(e) => set("storage", e.target.value)}
            />
          </Field>

          {form.type === "dir" ? (
            <Field id="sf-path" label={t("storage.add.path")} hint={t("storage.add.pathHint")} required>
              <Input id="sf-path"
                  value={form.path} placeholder="/mnt/data" onChange={(e) => set("path", e.target.value)} />
            </Field>
          ) : null}

          {form.type === "nfs" || form.type === "cifs" || form.type === "pbs" ? (
            <div className="grid gap-3 sm:grid-cols-[1fr_8rem]">
              <Field id="sf-server" label={t("storage.add.server")} hint={t("storage.add.serverHint")} required>
                <Input id="sf-server"
                  value={form.server} placeholder="192.168.1.10" onChange={(e) => set("server", e.target.value)} />
              </Field>
              {form.type === "pbs" ? (
                <Field id="sf-port" label={t("storage.add.port")}>
                  <Input
                    id="sf-port"
                  inputMode="numeric"
                    value={form.port}
                    placeholder="8007"
                    onChange={(e) => set("port", e.target.value.replace(/\D/g, "").slice(0, 5))}
                  />
                </Field>
              ) : form.type === "nfs" ? (
                <Field id="sf-nfsVersion" label={t("storage.add.nfsVersion")}>
                  <select
                    id="sf-nfsVersion"
                    className={cn(SELECT_CLASS, "mt-0")}
                    value={form.nfsVersion}
                    onChange={(e) => set("nfsVersion", e.target.value as Form["nfsVersion"])}
                  >
                    <option value="">{t("storage.add.auto")}</option>
                    <option value="3">3</option>
                    <option value="4">4</option>
                    <option value="4.1">4.1</option>
                    <option value="4.2">4.2</option>
                  </select>
                </Field>
              ) : (
                <Field id="sf-smbVersion" label={t("storage.add.smbVersion")}>
                  <select
                    id="sf-smbVersion"
                    className={cn(SELECT_CLASS, "mt-0")}
                    value={form.smbVersion}
                    onChange={(e) => set("smbVersion", e.target.value as Form["smbVersion"])}
                  >
                    <option value="default">{t("storage.add.auto")}</option>
                    <option value="2.0">2.0</option>
                    <option value="2.1">2.1</option>
                    <option value="3">3</option>
                    <option value="3.0">3.0</option>
                    <option value="3.11">3.11</option>
                  </select>
                </Field>
              )}
            </div>
          ) : null}

          {form.type === "cifs" || form.type === "pbs" ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field id="sf-username" label={t("storage.add.username")} required={form.type === "pbs"}>
                <Input
                  id="sf-username"
                  value={form.username}
                  autoComplete="off"
                  placeholder={form.type === "pbs" ? "backup@pbs" : ""}
                  onChange={(e) => set("username", e.target.value)}
                />
              </Field>
              <Field id="sf-password" label={t("storage.add.password")} required={form.type === "pbs"}>
                <Input
                  id="sf-password"
                  type="password"
                  value={form.password}
                  autoComplete="new-password"
                  onChange={(e) => set("password", e.target.value)}
                />
              </Field>
              {form.type === "cifs" ? (
                <Field id="sf-domain" label={t("storage.add.domain")}>
                  <Input id="sf-domain"
                  value={form.domain} onChange={(e) => set("domain", e.target.value)} />
                </Field>
              ) : null}
            </div>
          ) : null}

          {form.type === "pbs" ? (
            <Field id="sf-fingerprint" label={t("storage.add.fingerprint")} hint={t("storage.add.fingerprintHint")}>
              <Input
                id="sf-fingerprint"
                  value={form.fingerprint}
                className="font-mono text-xs"
                placeholder="aa:bb:cc:…"
                onChange={(e) => set("fingerprint", e.target.value)}
              />
            </Field>
          ) : null}

          {form.type === "nfs" ? (
            <Field id="sf-export" label={t("storage.add.export")} required>
              {scanned("export", "/volume1/proxmox")}
              {scanControl}
            </Field>
          ) : null}
          {form.type === "cifs" ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field id="sf-share" label={t("storage.add.share")} required>
                {scanned("share", "proxmox")}
                {scanControl}
              </Field>
              <Field id="sf-subdir" label={t("storage.add.subdir")}>
                <Input id="sf-subdir"
                  value={form.subdir} placeholder="/backups" onChange={(e) => set("subdir", e.target.value)} />
              </Field>
            </div>
          ) : null}
          {form.type === "pbs" ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field id="sf-datastore" label={t("storage.add.datastore")} required>
                {scanned("datastore", "store1")}
                {scanControl}
              </Field>
              <Field id="sf-namespace" label={t("storage.add.namespace")}>
                <Input id="sf-namespace"
                  value={form.namespace} onChange={(e) => set("namespace", e.target.value)} />
              </Field>
            </div>
          ) : null}
          {form.type === "lvm" ? (
            <Field id="sf-vgname" label={t("storage.add.vgname")} required>
              {scanned("vgname", "vg-data")}
              {scanControl}
            </Field>
          ) : null}
          {form.type === "lvmthin" ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field id="sf-vgname" label={t("storage.add.vgname")} required>
                <Input id="sf-vgname" value={form.vgname} placeholder="pve" onChange={(e) => set("vgname", e.target.value)} />
              </Field>
              <Field id="sf-thinpool" label={t("storage.add.thinpool")} required>
                {scanned("thinpool", "data")}
                {scanControl}
              </Field>
            </div>
          ) : null}
          {form.type === "zfspool" ? (
            <Field id="sf-pool" label={t("storage.add.pool")} required>
              {scanned("pool", "tank")}
              {scanControl}
            </Field>
          ) : null}

          <Field label={t("storage.content")} required>
            <div className="flex flex-wrap gap-1.5">
              {STORAGE_TYPE_CONTENT[form.type].map((item) => {
                const active = form.content.includes(item);
                return (
                  <button
                    key={item}
                    type="button"
                    aria-pressed={active}
                    onClick={() => toggleContent(item)}
                    className={cn(
                      "h-8 rounded-full border px-3 text-xs font-medium transition-colors",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      active
                        ? "border-primary/60 bg-primary/15 text-foreground"
                        : "border-border text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground",
                    )}
                  >
                    {t(`storage.add.content.${item}` as MessageKey)}
                  </button>
                );
              })}
            </div>
          </Field>

          {nodes.length > 1 ? (
            <Field label={t("storage.add.nodes")} hint={t("storage.add.nodesHint")}>
              <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                {nodes.map((n) => (
                  <label key={n} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={form.nodes.includes(n)} onChange={() => toggleNode(n)} />
                    {n}
                  </label>
                ))}
              </div>
            </Field>
          ) : null}

          <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
            {form.type === "dir" || form.type === "lvm" ? (
              <label className="flex items-center gap-2" title={t("storage.add.sharedHint")}>
                <input type="checkbox" checked={form.shared} onChange={(e) => set("shared", e.target.checked)} />
                {t("storage.add.shared")}
              </label>
            ) : null}
            {form.type === "zfspool" ? (
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={form.sparse} onChange={(e) => set("sparse", e.target.checked)} />
                {t("storage.add.sparse")}
              </label>
            ) : null}
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={!form.disable} onChange={(e) => set("disable", !e.target.checked)} />
              {t("settings.enabled")}
            </label>
          </div>

          <div className="flex justify-end gap-2 border-t border-border pt-3">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={busy || invalid}>
              {busy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Plus className="mr-1 h-3.5 w-3.5" />}
              {t("storage.add.submit")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
