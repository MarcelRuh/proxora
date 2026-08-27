"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";
import { api } from "@/lib/api";
import type { PublicHost } from "@/lib/types";
import { PageHeader } from "@/components/layout/page-header";

const STEPS = ["General", "OS", "System", "Memory", "Disk", "Network", "Confirm"];

export default function CreateVmPage() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const { data: hosts } = useQuery({
    queryKey: ["hosts"],
    queryFn: () => api<{ hosts: PublicHost[] }>("/api/hosts"),
  });
  const [form, setForm] = useState({
    hostId: "",
    node: "",
    vmid: 100,
    name: "",
    description: "",
    ostype: "l26",
    iso: "",
    bios: "seabios",
    machine: "q35",
    efi: false,
    tpm: false,
    cpu: "x86-64-v2-AES",
    sockets: 1,
    cores: 2,
    numa: false,
    memory: 2048,
    balloon: 0,
    diskStorage: "local-lvm",
    diskSize: "32",
    diskBus: "scsi" as const,
    cache: "none",
    discard: true,
    ssd: true,
    bridge: "vmbr0",
    vlan: "",
    netModel: "virtio",
    mac: "",
  });
  const { data: options } = useQuery({
    queryKey: ["options", form.hostId],
    enabled: Boolean(form.hostId),
    queryFn: () => api<{ nodes: Array<{ node: string }>; nextid: number; isos: Array<{ volid: string }>; storage: Array<{ storage: string }>; bridges: Array<{ iface: string }> }>(
      `/api/hosts/${form.hostId}/options`,
    ),
  });

  const create = useMutation({
    mutationFn: () =>
      api(`/api/hosts/${form.hostId}/vms`, {
        method: "POST",
        body: JSON.stringify({
          ...form,
          vlan: form.vlan ? Number(form.vlan) : undefined,
          diskSize: form.diskSize,
        }),
      }),
    onSuccess: () => {
      toast.success("VM create task started");
      router.push("/vms");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <PageHeader kicker="Virtualisierung" title="VM erstellen" />
      <div className="flex flex-wrap gap-2 text-xs">
        {STEPS.map((s, i) => (
          <span key={s} className={i === step ? "font-semibold text-primary" : "text-muted-foreground"}>
            {i + 1}. {s}
          </span>
        ))}
      </div>
      <Card>
        <CardHeader>
          <CardTitle>{STEPS[step]}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3">
          {step === 0 ? (
            <>
              <SelectHost hosts={hosts?.hosts ?? []} value={form.hostId} onChange={(hostId) => setForm({ ...form, hostId, node: options?.nodes[0]?.node ?? "" })} />
              <Field label="Node" value={form.node || options?.nodes[0]?.node || ""} onChange={(node) => setForm({ ...form, node })} />
              <Field label="VM ID" value={String(form.vmid || options?.nextid || "")} onChange={(v) => setForm({ ...form, vmid: Number(v) })} />
              <Field label="Name" value={form.name} onChange={(name) => setForm({ ...form, name })} />
              <Field label="Description" value={form.description} onChange={(description) => setForm({ ...form, description })} />
            </>
          ) : null}
          {step === 1 ? (
            <>
              <label className="text-sm">
                ISO
                <select
                  className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2"
                  value={form.iso}
                  onChange={(e) => setForm({ ...form, iso: e.target.value })}
                >
                  <option value="">None</option>
                  {(options?.isos ?? []).map((iso) => (
                    <option key={iso.volid} value={iso.volid}>
                      {iso.volid}
                    </option>
                  ))}
                </select>
              </label>
              <Field label="BIOS" value={form.bios} onChange={(bios) => setForm({ ...form, bios })} />
              <Field label="Machine" value={form.machine} onChange={(machine) => setForm({ ...form, machine })} />
              <Toggle label="EFI disk" checked={form.efi} onChange={(efi) => setForm({ ...form, efi })} />
              <Toggle label="TPM" checked={form.tpm} onChange={(tpm) => setForm({ ...form, tpm })} />
            </>
          ) : null}
          {step === 2 ? (
            <>
              <Field label="CPU type" value={form.cpu} onChange={(cpu) => setForm({ ...form, cpu })} />
              <Field label="Sockets" value={String(form.sockets)} onChange={(v) => setForm({ ...form, sockets: Number(v) })} />
              <Field label="Cores" value={String(form.cores)} onChange={(v) => setForm({ ...form, cores: Number(v) })} />
              <Toggle label="NUMA" checked={form.numa} onChange={(numa) => setForm({ ...form, numa })} />
            </>
          ) : null}
          {step === 3 ? (
            <>
              <Field label="RAM (MiB)" value={String(form.memory)} onChange={(v) => setForm({ ...form, memory: Number(v) })} />
              <Field label="Balloon (MiB, 0=off)" value={String(form.balloon)} onChange={(v) => setForm({ ...form, balloon: Number(v) })} />
            </>
          ) : null}
          {step === 4 ? (
            <>
              <Field label="Storage" value={form.diskStorage} onChange={(diskStorage) => setForm({ ...form, diskStorage })} />
              <Field label="Size (GiB)" value={form.diskSize} onChange={(diskSize) => setForm({ ...form, diskSize })} />
              <Field label="Cache" value={form.cache} onChange={(cache) => setForm({ ...form, cache })} />
              <Toggle label="Discard" checked={form.discard} onChange={(discard) => setForm({ ...form, discard })} />
              <Toggle label="SSD emulation" checked={form.ssd} onChange={(ssd) => setForm({ ...form, ssd })} />
            </>
          ) : null}
          {step === 5 ? (
            <>
              <Field label="Bridge" value={form.bridge} onChange={(bridge) => setForm({ ...form, bridge })} />
              <Field label="VLAN" value={form.vlan} onChange={(vlan) => setForm({ ...form, vlan })} />
              <Field label="Model" value={form.netModel} onChange={(netModel) => setForm({ ...form, netModel })} />
              <Field label="MAC" value={form.mac} onChange={(mac) => setForm({ ...form, mac })} />
            </>
          ) : null}
          {step === 6 ? (
            <pre className="overflow-auto rounded-md bg-muted p-3 text-xs">{JSON.stringify(form, null, 2)}</pre>
          ) : null}
          <div className="flex justify-between pt-2">
            <Button variant="outline" disabled={step === 0} onClick={() => setStep((s) => s - 1)}>
              Back
            </Button>
            {step < STEPS.length - 1 ? (
              <Button onClick={() => setStep((s) => s + 1)}>Next</Button>
            ) : (
              <Button onClick={() => create.mutate()} disabled={create.isPending}>
                Create VM
              </Button>
            )}
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
function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}
function SelectHost({
  hosts,
  value,
  onChange,
}: {
  hosts: PublicHost[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="text-sm">
      Host
      <select className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Select host</option>
        {hosts.map((h) => (
          <option key={h.id} value={h.id}>
            {h.name}
          </option>
        ))}
      </select>
    </label>
  );
}
