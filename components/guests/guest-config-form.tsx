"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { buildMpSpec, isBindVolume, nextIndexedKey, parseMpSpec } from "@/lib/proxmox-mp";

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

const CPU_KEYS = ["cores", "sockets", "vcpus", "memory", "balloon", "swap", "cpuunits"];
const META_KEYS = ["name", "hostname", "ostype", "tags", "description"];
/** Keep in form state (so save does not delete them) but do not show. */
const HIDDEN_UI_KEYS = new Set(["cpu", "cpulimit"]);

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
  busy,
}: {
  kind: "vm" | "lxc";
  vmid: number;
  config: Record<string, unknown>;
  onSave: (payload: Record<string, unknown>) => Promise<void>;
  busy?: boolean;
}) {
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
      toast.error("Host-Pfad muss absolut sein, z. B. /host/dir");
      return;
    }
    const options = bindRo ? ["ro=1"] : [];
    setField(nextMp, buildMpSpec(host, guest, options));
  }

  function addVolumeMount() {
    const volume = volStorage.trim();
    const guest = volGuest.trim();
    if (!volume || !guest) {
      toast.error("Storage und Container-Pfad angeben");
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
    for (const key of Object.keys(original)) {
      if (!(key in form)) deleted.push(key);
    }
    for (const [key, value] of Object.entries(form)) {
      if (original[key] === value) continue;
      if (!(key in original) && value === "") continue;
      payload[key] = coerce(key, value);
    }
    if (deleted.length) payload.delete = deleted.join(",");
    if (Object.keys(payload).length === 0) {
      toast.message("Keine Änderungen");
      return;
    }
    await onSave(payload);
  }

  const cpuKeys = primary.filter((k) => CPU_KEYS.includes(k));
  const metaKeys = primary.filter((k) => META_KEYS.includes(k));

  return (
    <div className="space-y-4">
      <Section title="CPU & RAM" description="Kerne und Speicher des Gastes.">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {cpuKeys.map((key) => (
            <Field key={key} name={key} value={form[key] ?? ""} onChange={(v) => setField(key, v)} hint={hintFor(key)} />
          ))}
        </div>
      </Section>

      <Section title="Allgemein" description={kind === "lxc" ? "Hostname, OS und Startverhalten." : "Name, OS und Startverhalten."}>
        <div className="grid gap-3 sm:grid-cols-2">
          {metaKeys.map((key) => (
            <Field key={key} name={key} value={form[key] ?? ""} onChange={(v) => setField(key, v)} hint={hintFor(key)} />
          ))}
          {flags.map((key) => (
            <label key={key} className="flex h-9 items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form[key] === "1" || form[key]?.startsWith("enabled=1")}
                onChange={(e) => setField(key, e.target.checked ? "1" : "0")}
              />
              {labelFor(key)}
            </label>
          ))}
        </div>
      </Section>

      {disks.length ? (
        <Section title="Disks" description="Rootfs und virtuelle Datenträger.">
          <div className="space-y-2">
            {disks.map((key) => (
              <RowField key={key} name={key} value={form[key] ?? ""} onChange={(v) => setField(key, v)} onRemove={() => removeField(key)} />
            ))}
          </div>
        </Section>
      ) : null}

      {kind === "lxc" ? (
        <Section
          title="Mountpoints"
          description={`Entspricht pct set ${vmid} -${nextMp} /host/dir,mp=/container/mount/point`}
        >
          <div className="space-y-4">
            {mounts.length === 0 ? (
              <p className="text-sm text-muted-foreground">Noch keine Mountpoints.</p>
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

            <div className="grid gap-4 lg:grid-cols-2">
              <div className="space-y-3 rounded-lg border border-border p-4">
                <div>
                  <p className="text-sm font-medium">Bind-Mount (Host-Ordner)</p>
                  <p className="text-xs text-muted-foreground">
                    pct set {vmid} -{nextMp} {bindHost || "/host/dir"},mp={bindGuest || "/container/mount/point"}
                  </p>
                </div>
                <Field name="hostDir" value={bindHost} onChange={setBindHost} hint="Pfad auf dem Proxmox-Host" />
                <Field name="guestDir" value={bindGuest} onChange={setBindGuest} hint="Pfad im Container" />
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={bindRo} onChange={(e) => setBindRo(e.target.checked)} />
                  Nur lesen
                </label>
                <Button type="button" variant="outline" onClick={addBindMount}>
                  {nextMp} Bind-Mount anlegen
                </Button>
              </div>

              <div className="space-y-3 rounded-lg border border-border p-4">
                <div>
                  <p className="text-sm font-medium">Storage-Volume</p>
                  <p className="text-xs text-muted-foreground">Neue Disk aus einem Storage, z. B. local-lvm:8</p>
                </div>
                <Field name="volume" value={volStorage} onChange={setVolStorage} hint="storage:größe" />
                <Field name="guestDir" value={volGuest} onChange={setVolGuest} hint="Pfad im Container" />
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={volBackup} onChange={(e) => setVolBackup(e.target.checked)} />
                  Backup
                </label>
                <Button type="button" variant="outline" onClick={addVolumeMount}>
                  {nextMp} Volume anlegen
                </Button>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Danach Config speichern. Für neue Mountpoints sollte der Container aus sein.
            </p>
          </div>
        </Section>
      ) : null}

      <Section title="Netzwerk" description="Bridges und IP-Konfiguration (net0, net1, …).">
        <div className="space-y-2">
          {nets.length === 0 ? <p className="text-sm text-muted-foreground">Keine Netzwerkeinträge.</p> : null}
          {nets.map((key) => (
            <RowField key={key} name={key} value={form[key] ?? ""} onChange={(v) => setField(key, v)} onRemove={() => removeField(key)} />
          ))}
        </div>
      </Section>

      <Section title="Weitere Optionen" description="Alle übrigen Proxmox-Keys.">
        <div className="space-y-2">
          {rest.map((key) => (
            <RowField key={key} name={key} value={form[key] ?? ""} onChange={(v) => setField(key, v)} onRemove={() => removeField(key)} />
          ))}
          <div className="flex flex-wrap gap-2 pt-2">
            <Input placeholder="Schlüssel" value={newKey} onChange={(e) => setNewKey(e.target.value)} className="max-w-48 font-mono" />
            <Input placeholder="Wert" value={newValue} onChange={(e) => setNewValue(e.target.value)} className="min-w-48 flex-1 font-mono" />
            <Button type="button" variant="outline" onClick={addField}>
              Hinzufügen
            </Button>
          </div>
        </div>
      </Section>

      <div className="sticky bottom-4 flex justify-end gap-2 rounded-xl border border-border bg-card/95 p-3 shadow-sm backdrop-blur">
        <Button type="button" variant="outline" onClick={() => setForm(original)} disabled={busy}>
          Zurücksetzen
        </Button>
        <Button type="button" onClick={() => void save()} disabled={busy}>
          {busy ? "Speichern…" : "Config speichern"}
        </Button>
      </div>
    </div>
  );
}

function preferredOrder(kind: "vm" | "lxc") {
  return kind === "lxc"
    ? ["hostname", "ostype", "cores", "memory", "swap", "cpuunits", "tags", "description"]
    : ["name", "ostype", "cores", "sockets", "vcpus", "memory", "balloon", "tags", "description"];
}

function hintFor(key: string) {
  if (key === "memory" || key === "balloon" || key === "swap") return "MB";
  if (key === "cores" || key === "sockets" || key === "vcpus") return "Anzahl";
  return undefined;
}

function labelFor(key: string) {
  const map: Record<string, string> = {
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
  };
  return map[key] ?? key;
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
  return (
    <div className="space-y-1">
      <Label>
        {labelFor(name)}
        {hint ? <span className="ml-1 text-xs font-normal text-muted-foreground">{hint}</span> : null}
      </Label>
      <Input value={value} onChange={(e) => onChange(e.target.value)} className={name === "description" ? undefined : "font-mono"} />
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
  return (
    <div className="flex gap-2">
      <span className="flex h-9 w-28 shrink-0 items-center font-mono text-xs text-muted-foreground">{name}</span>
      <Input value={value} onChange={(e) => onChange(e.target.value)} className="font-mono text-xs" />
      <Button type="button" size="sm" variant="ghost" onClick={onRemove}>
        Entfernen
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
  const parsed = parseMpSpec(value);
  const bind = isBindVolume(parsed.volume);
  return (
    <div className="space-y-2 rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm">{name}</span>
          <Badge variant={bind ? "default" : "muted"}>{bind ? "Bind-Mount" : "Volume"}</Badge>
        </div>
        <Button type="button" size="sm" variant="ghost" onClick={onRemove}>
          Entfernen
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
