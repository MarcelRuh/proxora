"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";

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

function isNet(key: string) {
  return /^net\d+$/.test(key);
}
function isMp(key: string) {
  return /^mp\d+$/.test(key);
}
function isDisk(key: string) {
  return /^(scsi|sata|virtio|ide|efidisk|tpmstate|unused)\d+$/.test(key) || key === "rootfs";
}

function nextIndexedKey(prefix: string, form: Record<string, string>, max = 256) {
  for (let i = 0; i < max; i++) {
    if (!(`${prefix}${i}` in form)) return `${prefix}${i}`;
  }
  return `${prefix}0`;
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
  config,
  onSave,
  busy,
}: {
  kind: "vm" | "lxc";
  config: Record<string, unknown>;
  onSave: (payload: Record<string, unknown>) => Promise<void>;
  busy?: boolean;
}) {
  const original = useMemo(() => stringifyConfig(config), [config]);
  const [form, setForm] = useState(original);
  const [mpVolume, setMpVolume] = useState("local-lvm:8");
  const [mpPath, setMpPath] = useState("/mnt/data");
  const [mpBackup, setMpBackup] = useState(true);
  const [mpRo, setMpRo] = useState(false);
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");

  useEffect(() => {
    setForm(original);
  }, [original]);

  const primary = preferredOrder(kind);
  const keys = Object.keys(form).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const flags = Array.from(new Set(["onboot", ...(kind === "vm" ? ["agent", "numa"] : ["unprivileged"]), ...keys.filter((k) => FLAG_KEYS.has(k))]));
  const nets = keys.filter(isNet);
  const disks = keys.filter(isDisk);
  const mounts = keys.filter(isMp);
  const rest = keys.filter((k) => !isNet(k) && !isDisk(k) && !isMp(k) && !FLAG_KEYS.has(k) && !primary.includes(k));

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

  function addMount() {
    const volume = mpVolume.trim();
    const path = mpPath.trim();
    if (!volume || !path) {
      toast.error("Volume und Mountpfad angeben");
      return;
    }
    const key = nextIndexedKey("mp", form);
    const parts = [volume, `mp=${path.startsWith("/") ? path : `/${path}`}`];
    if (mpBackup) parts.push("backup=1");
    if (mpRo) parts.push("ro=1");
    setField(key, parts.join(","));
    setMpPath("/mnt/data");
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

  return (
    <div className="space-y-4">
      <Section title={kind === "lxc" ? "Container" : "VM"}>
        <div className="grid gap-3 sm:grid-cols-2">
          {primary.map((key) => (
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
        <Section title="Disks">
          <div className="space-y-2">
            {disks.map((key) => (
              <RowField key={key} name={key} value={form[key] ?? ""} onChange={(v) => setField(key, v)} onRemove={() => removeField(key)} />
            ))}
          </div>
        </Section>
      ) : null}

      {kind === "lxc" ? (
        <Section title="Mountpoints">
          <div className="space-y-2">
            {mounts.map((key) => (
              <RowField key={key} name={key} value={form[key] ?? ""} onChange={(v) => setField(key, v)} onRemove={() => removeField(key)} />
            ))}
            <div className="grid gap-2 rounded-lg border border-dashed border-border p-3 sm:grid-cols-2">
              <Field name="volume" value={mpVolume} onChange={setMpVolume} hint="z. B. local-lvm:8" />
              <Field name="mp" value={mpPath} onChange={setMpPath} hint="Gastpfad" />
              <label className="flex h-9 items-center gap-2 text-sm">
                <input type="checkbox" checked={mpBackup} onChange={(e) => setMpBackup(e.target.checked)} />
                Backup
              </label>
              <label className="flex h-9 items-center gap-2 text-sm">
                <input type="checkbox" checked={mpRo} onChange={(e) => setMpRo(e.target.checked)} />
                Nur lesen
              </label>
              <div className="sm:col-span-2">
                <Button type="button" variant="outline" onClick={addMount}>
                  Mountpoint {nextIndexedKey("mp", form)} anlegen
                </Button>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Volume `storage:größe` legt eine neue Disk an. Danach Config speichern — der Container sollte dafür aus sein.
            </p>
          </div>
        </Section>
      ) : null}

      {nets.length ? (
        <Section title="Netzwerk">
          <div className="space-y-2">
            {nets.map((key) => (
              <RowField key={key} name={key} value={form[key] ?? ""} onChange={(v) => setField(key, v)} onRemove={() => removeField(key)} />
            ))}
          </div>
        </Section>
      ) : null}

      <Section title="Weitere Optionen">
        <div className="space-y-2">
          {rest.map((key) => (
              <RowField key={key} name={key} value={form[key] ?? ""} onChange={(v) => setField(key, v)} onRemove={() => removeField(key)} />
            ))}
          <div className="flex flex-wrap gap-2 pt-2">
            <Input placeholder="Schlüssel (z. B. net1)" value={newKey} onChange={(e) => setNewKey(e.target.value)} className="max-w-48 font-mono" />
            <Input placeholder="Wert" value={newValue} onChange={(e) => setNewValue(e.target.value)} className="min-w-48 flex-1 font-mono" />
            <Button type="button" variant="outline" onClick={addField}>
              Hinzufügen
            </Button>
          </div>
        </div>
      </Section>

      <div className="flex justify-end gap-2">
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
    ? ["hostname", "ostype", "cores", "memory", "swap", "cpulimit", "cpuunits", "tags", "description"]
    : ["name", "ostype", "cores", "sockets", "vcpus", "cpu", "memory", "balloon", "tags", "description"];
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

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
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
      {name === "description" ? (
        <Input value={value} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <Input value={value} onChange={(e) => onChange(e.target.value)} className="font-mono" />
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
