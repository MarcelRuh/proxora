"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { buildMpSpec, isBindVolume, nextIndexedKey, parseMpSpec } from "@/lib/proxmox-mp";
import { canResizeDisk, diskSizeDeltaGiB, formatDiskGiB, parseDiskSpec, setDiskSize } from "@/lib/proxmox-disk";
import { useI18n } from "@/components/i18n/locale-provider";
import type { Locale } from "@/lib/i18n/messages";

const SKIP = new Set(["digest"]);

const FLAG_KEYS = new Set([
  "onboot",
  "numa",
  "unprivileged",
  "protection",
  "tablet",
  "kvm",
  "acpi",
  "agent",
]);

const NUMBER_KEYS = new Set([
  "cores",
  "sockets",
  "vcpus",
  "memory",
  "balloon",
  "swap",
  "cpuunits",
  "cpulimit",
  "shares",
  "onboot",
  "numa",
  "unprivileged",
  "protection",
  "tablet",
  "kvm",
  "acpi",
]);

const CPU_KEYS = ["cores", "sockets", "vcpus", "memory", "balloon", "swap"];
const META_KEYS = ["name", "hostname", "ostype", "tags", "description"];
/** Keep in form state (so save does not delete them) but do not show. */
const HIDDEN_UI_KEYS = new Set(["cpu", "cpulimit", "cpuunits"]);

function isNet(key: string) {
  return /^net\d+$/.test(key);
}
function isMp(key: string) {
  return /^mp\d+$/.test(key);
}
function isDisk(key: string) {
  return /^(scsi|sata|virtio|ide|efidisk|tpmstate|unused)\d+$/.test(key) || key === "rootfs";
}

function stringifyConfig(config: Record<string, unknown>) {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(config)) {
    if (SKIP.has(key) || value === undefined || value === null) continue;
    out[key] = String(value);
  }
  return out;
}

function coerce(key: string, value: string): unknown {
  if (FLAG_KEYS.has(key) && (value === "0" || value === "1")) return Number(value);
  if (NUMBER_KEYS.has(key) && value !== "" && /^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  return value;
}

export function GuestConfigForm({
  kind,
  vmid,
  config,
  onSave,
  onResize,
  busy,
  readOnly,
}: {
  kind: "vm" | "lxc";
  vmid: number;
  config: Record<string, unknown>;
  onSave: (payload: Record<string, unknown>) => Promise<void>;
  onResize?: (disk: string, size: string) => Promise<void>;
  busy?: boolean;
  readOnly?: boolean;
}) {
  const { t, locale } = useI18n();
  const original = useMemo(() => stringifyConfig(config), [config]);
  const [form, setForm] = useState(original);
  const [bindHost, setBindHost] = useState("/host/dir");
  const [bindGuest, setBindGuest] = useState("/container/mount/point");
  const [bindRo, setBindRo] = useState(false);
  const [volStorage, setVolStorage] = useState("local-lvm:8");
  const [volGuest, setVolGuest] = useState("/mnt/data");
  const [volBackup, setVolBackup] = useState(true);
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");

  useEffect(() => {
    setForm(original);
  }, [original]);

  const primary = preferredOrder(kind);
  const keys = Object.keys(form).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const flags = Array.from(
    new Set(["onboot", ...(kind === "vm" ? ["agent", "numa"] : ["unprivileged"]), ...keys.filter((k) => FLAG_KEYS.has(k))]),
  );
  const nets = keys.filter(isNet);
  const disks = keys.filter(isDisk);
  const mounts = keys.filter(isMp);
  const rest = keys.filter(
    (k) =>
      !isNet(k) &&
      !isDisk(k) &&
      !isMp(k) &&
      !FLAG_KEYS.has(k) &&
      !primary.includes(k) &&
      !HIDDEN_UI_KEYS.has(k),
  );
  const nextMp = nextIndexedKey("mp", Object.keys(form));

  function setField(key: string, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function removeField(key: string) {
    setForm((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }

  function addBindMount() {
    const host = bindHost.trim();
    const guest = bindGuest.trim();
    if (!host.startsWith("/") || !guest) {
      toast.error(t("config.bindPathError"));
      return;
    }
    const options = bindRo ? ["ro=1"] : [];
    setField(nextMp, buildMpSpec(host, guest, options));
  }

  function addVolumeMount() {
    const volume = volStorage.trim();
    const guest = volGuest.trim();
    if (!volume || !guest) {
      toast.error(t("config.volumeError"));
      return;
    }
    const options = volBackup ? ["backup=1"] : [];
    setField(nextMp, buildMpSpec(volume, guest, options));
  }

  function addField() {
    const key = newKey.trim();
    if (!key) return;
    setForm((prev) => ({ ...prev, [key]: newValue }));
    setNewKey("");
    setNewValue("");
  }

  async function save() {
    const payload: Record<string, unknown> = {};
    const deleted: string[] = [];
    const resizes: Array<{ disk: string; size: string }> = [];
    for (const key of Object.keys(original)) {
      if (!(key in form)) deleted.push(key);
    }
    for (const [key, value] of Object.entries(form)) {
      if (original[key] === value) continue;
      if (!(key in original) && value === "") continue;
      if (isDisk(key) && original[key] && canResizeDisk(key, value)) {
        const delta = diskSizeDeltaGiB(original[key], value);
        if (delta != null && delta < -0.001) {
          toast.error(t("config.diskShrink"));
          return;
        }
        if (delta != null && delta > 0.001) {
          const nextSize = parseDiskSpec(value).sizeGiB;
          if (nextSize == null) continue;
          resizes.push({ disk: key, size: formatDiskGiB(nextSize) });
          const previousSize = parseDiskSpec(original[key]).sizeGiB;
          const reverted = previousSize != null ? setDiskSize(value, previousSize) : original[key];
          if (reverted !== original[key]) payload[key] = coerce(key, reverted);
          continue;
        }
      }
      payload[key] = coerce(key, value);
    }
    if (deleted.length) payload.delete = deleted.join(",");
    if (!resizes.length && Object.keys(payload).length === 0) {
      toast.message(t("config.noChanges"));
      return;
    }
    if (resizes.length && !onResize) {
      toast.error(t("config.diskResizeUnsupported"));
      return;
    }
    for (const item of resizes) await onResize?.(item.disk, item.size);
    if (Object.keys(payload).length) await onSave(payload);
  }

  const cpuKeys = primary.filter((k) => CPU_KEYS.includes(k));
  const metaKeys = primary.filter((k) => META_KEYS.includes(k));

  return (
    <fieldset disabled={readOnly} className="space-y-4 border-0 p-0">
      <Section title={t("config.cpuRam")} description={t("config.cpuRamBody")}>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {cpuKeys.map((key) => (
            <Field key={key} name={key} value={form[key] ?? ""} onChange={(v) => setField(key, v)} hint={hintFor(key, locale)} />
          ))}
        </div>
      </Section>

      <Section title={t("config.general")} description={kind === "lxc" ? t("config.generalLxc") : t("config.generalVm")}>
        <div className="grid gap-3 sm:grid-cols-2">
          {metaKeys.map((key) => (
            <Field key={key} name={key} value={form[key] ?? ""} onChange={(v) => setField(key, v)} hint={hintFor(key, locale)} />
          ))}
          {flags.map((key) => (
            <label key={key} className="flex h-9 items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form[key] === "1" || form[key]?.startsWith("enabled=1")}
                onChange={(e) => setField(key, e.target.checked ? "1" : "0")}
              />
              {labelFor(key, locale)}
            </label>
          ))}
        </div>
      </Section>

      {disks.length ? (
        <Section title={t("config.disks")} description={t("config.disksBody")}>
          <div className="space-y-2">
            {disks.map((key) => (
              <DiskRow
                key={key}
                name={key}
                value={form[key] ?? ""}
                onChange={(v) => setField(key, v)}
                onRemove={key === "rootfs" ? undefined : () => removeField(key)}
              />
            ))}
          </div>
        </Section>
      ) : null}

      {kind === "lxc" ? (
        <Section
          title={t("config.mounts")}
          description={t("config.mountsBody", { vmid, mp: nextMp })}
        >
          <div className="space-y-4">
            {mounts.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("config.noMounts")}</p>
            ) : (
              <div className="space-y-3">
                {mounts.map((key) => (
                  <MountRow
                    key={key}
                    name={key}
                    value={form[key] ?? ""}
                    onChange={(v) => setField(key, v)}
                    onRemove={() => removeField(key)}
                  />
                ))}
              </div>
            )}

            {readOnly ? null : (
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="space-y-3 rounded-lg border border-border p-4">
                <div>
                  <p className="text-sm font-medium">{t("config.bindTitle")}</p>
                  <p className="text-xs text-muted-foreground">
                    pct set {vmid} -{nextMp} {bindHost || "/host/dir"},mp={bindGuest || "/container/mount/point"}
                  </p>
                </div>
                <Field name="hostDir" value={bindHost} onChange={setBindHost} hint={t("config.hostPathHint")} />
                <Field name="guestDir" value={bindGuest} onChange={setBindGuest} hint={t("config.guestPathHint")} />
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={bindRo} onChange={(e) => setBindRo(e.target.checked)} />
                  {t("config.readOnly")}
                </label>
                <Button type="button" variant="outline" onClick={addBindMount}>
                  {t("config.addBind", { mp: nextMp })}
                </Button>
              </div>

              <div className="space-y-3 rounded-lg border border-border p-4">
                <div>
                  <p className="text-sm font-medium">{t("config.volumeTitle")}</p>
                  <p className="text-xs text-muted-foreground">{t("config.volumeBody")}</p>
                </div>
                <Field name="volume" value={volStorage} onChange={setVolStorage} hint={t("config.volumeHint")} />
                <Field name="guestDir" value={volGuest} onChange={setVolGuest} hint={t("config.guestPathHint")} />
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={volBackup} onChange={(e) => setVolBackup(e.target.checked)} />
                  {t("nav.backups")}
                </label>
                <Button type="button" variant="outline" onClick={addVolumeMount}>
                  {t("config.addVolume", { mp: nextMp })}
                </Button>
              </div>
            </div>
            )}
          </div>
        </Section>
      ) : null}

      <Section title={t("guest.network")} description={t("config.netBody")}>
        <div className="space-y-2">
          {nets.length === 0 ? <p className="text-sm text-muted-foreground">{t("config.noNets")}</p> : null}
          {nets.map((key) => (
            <RowField key={key} name={key} value={form[key] ?? ""} onChange={(v) => setField(key, v)} onRemove={() => removeField(key)} />
          ))}
        </div>
      </Section>

      <Section title={t("config.other")} description={t("config.otherBody")}>
        <div className="space-y-2">
          {rest.map((key) => (
            <RowField key={key} name={key} value={form[key] ?? ""} onChange={(v) => setField(key, v)} onRemove={() => removeField(key)} />
          ))}
          {readOnly ? null : (
          <div className="flex flex-wrap gap-2 pt-2">
            <Input placeholder={t("config.key")} value={newKey} onChange={(e) => setNewKey(e.target.value)} className="max-w-48 font-mono" />
            <Input placeholder={t("config.value")} value={newValue} onChange={(e) => setNewValue(e.target.value)} className="min-w-48 flex-1 font-mono" />
            <Button type="button" variant="outline" onClick={addField}>
              {t("config.add")}
            </Button>
          </div>
          )}
        </div>
      </Section>

      {readOnly ? null : (
      <div className="sticky bottom-4 flex justify-end gap-2 rounded-xl border border-border bg-card/95 p-3 shadow-sm backdrop-blur">
        <Button type="button" variant="outline" onClick={() => setForm(original)} disabled={busy}>
          {t("config.reset")}
        </Button>
        <Button type="button" onClick={() => void save()} disabled={busy}>
          {busy ? t("config.saving") : t("config.save")}
        </Button>
      </div>
      )}
    </fieldset>
  );
}

function preferredOrder(kind: "vm" | "lxc") {
  return kind === "lxc"
    ? ["hostname", "ostype", "cores", "memory", "swap", "tags", "description"]
    : ["name", "ostype", "cores", "sockets", "vcpus", "memory", "balloon", "tags", "description"];
}

function hintFor(key: string, locale: Locale) {
  if (key === "memory" || key === "balloon" || key === "swap") return "MB";
  if (key === "cores" || key === "sockets" || key === "vcpus") return locale === "en" ? "count" : "Anzahl";
  return undefined;
}

function labelFor(key: string, locale: Locale) {
  const de: Record<string, string> = {
    name: "Name",
    hostname: "Hostname",
    cores: "Kerne",
    sockets: "Sockets",
    vcpus: "vCPUs",
    cpu: "CPU-Typ",
    memory: "RAM",
    hostDir: "Host-Pfad",
    guestDir: "Container-Pfad",
    mp: "Mountpoint",
    volume: "Volume",
    balloon: "Balloon",
    swap: "Swap",
    onboot: "Autostart",
    ostype: "OS-Typ",
    description: "Beschreibung",
    tags: "Tags",
    unprivileged: "Unprivileged",
    numa: "NUMA",
    agent: "QEMU Agent",
    protection: "Schutz",
    cpulimit: "CPU-Limit",
    cpuunits: "CPU-Units",
    diskSize: "Größe",
  };
  const en: Record<string, string> = {
    name: "Name",
    hostname: "Hostname",
    cores: "Cores",
    sockets: "Sockets",
    vcpus: "vCPUs",
    cpu: "CPU type",
    memory: "RAM",
    hostDir: "Host path",
    guestDir: "Container path",
    mp: "Mount point",
    volume: "Volume",
    balloon: "Balloon",
    swap: "Swap",
    onboot: "Start at boot",
    ostype: "OS type",
    description: "Description",
    tags: "Tags",
    unprivileged: "Unprivileged",
    numa: "NUMA",
    agent: "QEMU agent",
    protection: "Protection",
    cpulimit: "CPU limit",
    cpuunits: "CPU units",
    diskSize: "Size",
  };
  return (locale === "en" ? en : de)[key] ?? key;
}

function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function Field({
  name,
  value,
  onChange,
  hint,
}: {
  name: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
}) {
  const { locale } = useI18n();
  return (
    <div className="space-y-1">
      <Label>
        {labelFor(name, locale)}
        {hint ? <span className="ml-1 text-xs font-normal text-muted-foreground">{hint}</span> : null}
      </Label>
      <Input value={value} onChange={(e) => onChange(e.target.value)} className={name === "description" ? undefined : "font-mono"} />
    </div>
  );
}

function DiskRow({
  name,
  value,
  onChange,
  onRemove,
}: {
  name: string;
  value: string;
  onChange: (v: string) => void;
  onRemove?: () => void;
}) {
  const { t } = useI18n();
  const spec = parseDiskSpec(value);
  const resizable = canResizeDisk(name, value);
  const sizeLabel = spec.sizeGiB == null ? "" : String(Number.isInteger(spec.sizeGiB) ? spec.sizeGiB : spec.sizeGiB);
  return (
    <div className="space-y-2 rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-mono text-sm">{name}</span>
        {onRemove ? (
          <Button type="button" size="sm" variant="ghost" onClick={onRemove}>
            {t("settings.remove")}
          </Button>
        ) : null}
      </div>
      <p className="truncate font-mono text-xs text-muted-foreground">{spec.volume || value}</p>
      {resizable ? (
        <Field
          name="diskSize"
          value={sizeLabel}
          onChange={(next) => {
            const n = Number(next.replace(",", "."));
            if (!Number.isFinite(n) || n <= 0) return;
            onChange(setDiskSize(value, n));
          }}
          hint="GiB"
        />
      ) : (
        <Input value={value} onChange={(e) => onChange(e.target.value)} className="font-mono text-xs" />
      )}
    </div>
  );
}

function RowField({
  name,
  value,
  onChange,
  onRemove,
}: {
  name: string;
  value: string;
  onChange: (v: string) => void;
  onRemove: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="flex gap-2">
      <span className="flex h-9 w-28 shrink-0 items-center font-mono text-xs text-muted-foreground">{name}</span>
      <Input value={value} onChange={(e) => onChange(e.target.value)} className="font-mono text-xs" />
      <Button type="button" size="sm" variant="ghost" onClick={onRemove}>
        {t("settings.remove")}
      </Button>
    </div>
  );
}

function MountRow({
  name,
  value,
  onChange,
  onRemove,
}: {
  name: string;
  value: string;
  onChange: (v: string) => void;
  onRemove: () => void;
}) {
  const { t } = useI18n();
  const parsed = parseMpSpec(value);
  const bind = isBindVolume(parsed.volume);
  return (
    <div className="space-y-2 rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm">{name}</span>
          <Badge variant={bind ? "default" : "muted"}>{bind ? t("config.bindTitle") : t("config.volumeTitle")}</Badge>
        </div>
        <Button type="button" size="sm" variant="ghost" onClick={onRemove}>
          {t("settings.remove")}
        </Button>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <Field
          name={bind ? "hostDir" : "volume"}
          value={parsed.volume}
          onChange={(volume) => onChange(buildMpSpec(volume, parsed.path, parsed.options))}
        />
        <Field
          name="guestDir"
          value={parsed.path}
          onChange={(path) => onChange(buildMpSpec(parsed.volume, path, parsed.options))}
        />
      </div>
      {parsed.options.length ? (
        <p className="font-mono text-[11px] text-muted-foreground">{parsed.options.join(", ")}</p>
      ) : null}
    </div>
  );
}
