"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label, Textarea } from "@/components/ui/input";
import { api } from "@/lib/api";
import type { PublicHost } from "@/lib/types";

export default function CreateLxcPage() {
  const router = useRouter();
  const { data: hosts } = useQuery({
    queryKey: ["hosts"],
    queryFn: () => api<{ hosts: PublicHost[] }>("/api/hosts"),
  });
  const [form, setForm] = useState({
    hostId: "",
    node: "",
    vmid: 200,
    hostname: "",
    password: "",
    sshKeys: "",
    ostemplate: "",
    storage: "local-lvm",
    diskSize: "8",
    cores: 2,
    memory: 1024,
    swap: 512,
    bridge: "vmbr0",
    vlan: "",
    ipv4: "dhcp",
    ipv6: "auto",
    gateway: "",
    nameserver: "",
    unprivileged: true,
    nesting: true,
  });
  const { data: options } = useQuery({
    queryKey: ["options", form.hostId],
    enabled: Boolean(form.hostId),
    queryFn: () =>
      api<{ nodes: Array<{ node: string }>; nextid: number; templates: Array<{ volid: string }> }>(
        `/api/hosts/${form.hostId}/options`,
      ),
  });
  const create = useMutation({
    mutationFn: () =>
      api(`/api/hosts/${form.hostId}/lxc`, {
        method: "POST",
        body: JSON.stringify({ ...form, vlan: form.vlan ? Number(form.vlan) : undefined }),
      }),
    onSuccess: () => {
      toast.success("Container create task started");
      router.push("/containers");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <h1 className="text-2xl font-semibold">Create Container</h1>
      <Card>
        <CardHeader>
          <CardTitle>LXC</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          <label className="text-sm md:col-span-2">
            Host
            <select
              className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2"
              value={form.hostId}
              onChange={(e) => setForm({ ...form, hostId: e.target.value, node: options?.nodes[0]?.node ?? "" })}
            >
              <option value="">Select host</option>
              {(hosts?.hosts ?? []).map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name}
                </option>
              ))}
            </select>
          </label>
          <Field label="Node" value={form.node || options?.nodes[0]?.node || ""} onChange={(node) => setForm({ ...form, node })} />
          <Field label="CT ID" value={String(form.vmid || options?.nextid || "")} onChange={(v) => setForm({ ...form, vmid: Number(v) })} />
          <Field label="Hostname" value={form.hostname} onChange={(hostname) => setForm({ ...form, hostname })} />
          <Field label="Password" type="password" value={form.password} onChange={(password) => setForm({ ...form, password })} />
          <label className="text-sm md:col-span-2">
            Template
            <select
              className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2"
              value={form.ostemplate}
              onChange={(e) => setForm({ ...form, ostemplate: e.target.value })}
            >
              <option value="">Select template</option>
              {(options?.templates ?? []).map((t) => (
                <option key={t.volid} value={t.volid}>
                  {t.volid}
                </option>
              ))}
            </select>
          </label>
          <div className="md:col-span-2 space-y-1">
            <Label>SSH keys</Label>
            <Textarea value={form.sshKeys} onChange={(e) => setForm({ ...form, sshKeys: e.target.value })} />
          </div>
          <Field label="Storage" value={form.storage} onChange={(storage) => setForm({ ...form, storage })} />
          <Field label="Root disk (GiB)" value={form.diskSize} onChange={(diskSize) => setForm({ ...form, diskSize })} />
          <Field label="Cores" value={String(form.cores)} onChange={(v) => setForm({ ...form, cores: Number(v) })} />
          <Field label="RAM (MiB)" value={String(form.memory)} onChange={(v) => setForm({ ...form, memory: Number(v) })} />
          <Field label="Swap" value={String(form.swap)} onChange={(v) => setForm({ ...form, swap: Number(v) })} />
          <Field label="Bridge" value={form.bridge} onChange={(bridge) => setForm({ ...form, bridge })} />
          <Field label="VLAN" value={form.vlan} onChange={(vlan) => setForm({ ...form, vlan })} />
          <Field label="IPv4" value={form.ipv4} onChange={(ipv4) => setForm({ ...form, ipv4 })} />
          <Field label="Gateway" value={form.gateway} onChange={(gateway) => setForm({ ...form, gateway })} />
          <Field label="DNS" value={form.nameserver} onChange={(nameserver) => setForm({ ...form, nameserver })} />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.unprivileged} onChange={(e) => setForm({ ...form, unprivileged: e.target.checked })} />
            Unprivileged
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.nesting} onChange={(e) => setForm({ ...form, nesting: e.target.checked })} />
            Nesting
          </label>
          <div className="md:col-span-2">
            <Button onClick={() => create.mutate()} disabled={create.isPending}>
              Create container
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
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
}) {
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      <Input type={type} value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}
