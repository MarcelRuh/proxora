import { z } from "zod";
import { apiRoute } from "@/server/http/api-route";
import { json } from "@/server/http/respond";
import { clientIp } from "@/server/auth/session";
import { writeAuditLog } from "@/server/services/audit-service";
import { AUDIT_ACTIONS } from "@/lib/audit-actions";
import { withHostClient } from "@/server/services/host-service";
import { filterGuestsForUser } from "@/server/auth/session-core";
import { attachGuestNotes } from "@/server/services/guest-notes";
import { fillVmDisksFromAgent } from "@/server/services/guest-disk";
import { completeGuestCreate } from "@/server/services/guest-start";
import { notifyTopic } from "@/server/notifications/dispatch";
import { durationLabel } from "@/lib/duration";
import { assertGuestIdentityFree } from "@/server/services/guest-ips";
import { ostypeFromIso, vmCdromDisks } from "@/lib/iso-images";
import { diskExtras, vmDiskSpec } from "@/lib/vm-storage";
import type { VmCreateParams } from "@/server/proxmox/vms";

export const maxDuration = 800;

const createVmSchema = z.object({
  node: z.string().min(1),
  vmid: z.number().int().positive(),
  name: z.string().min(1),
  description: z.string().optional(),
  ostype: z.string().optional(),
  memory: z.number().int().positive(),
  balloon: z.number().int().min(0).optional(),
  cores: z.number().int().positive(),
  sockets: z.number().int().positive().optional(),
  numa: z.boolean().optional(),
  cpu: z.string().optional(),
  scsihw: z.enum(["virtio-scsi-single", "virtio-scsi"]).optional(),
  iso: z.string().optional(),
  iso2: z.string().optional(),
  diskStorage: z.string().min(1),
  diskSize: z.string().optional(),
  diskVolume: z.string().optional(),
  diskBus: z.enum(["scsi", "virtio", "sata", "ide"]).default("scsi"),
  cache: z.string().optional(),
  discard: z.boolean().optional(),
  ssd: z.boolean().optional(),
  bridge: z.string().min(1),
  vlan: z.number().int().min(0).max(4094).optional(),
  netModel: z.string().default("virtio"),
  mac: z.string().optional(),
  bios: z.string().optional(),
  machine: z.string().optional(),
  efi: z.boolean().optional(),
  tpm: z.boolean().optional(),
  startAfter: z.boolean().optional(),
}).refine((body) => Boolean(body.diskVolume?.trim()) || Boolean(body.diskSize?.trim()), {
  message: "Disk-Größe oder Volume fehlt",
  path: ["diskSize"],
});

export const GET = apiRoute("vm.view", async (_req, session, params) => {
  const vms = await withHostClient(params.id, session.user, async (client) => {
    const listed = filterGuestsForUser(session.user, params.id, "vm", await client.listVms());
    await Promise.all([attachGuestNotes(client, listed, []), fillVmDisksFromAgent(client, listed)]);
    return listed;
  });
  return json({ vms });
});

export const POST = apiRoute("vm.create", async (req, session, params) => {
  const body = createVmSchema.parse(await req.json());
  const extras = diskExtras({
    cache: body.cache,
    discard: body.discard,
    ssd: body.ssd,
    diskBus: body.diskBus,
    scsihw: body.scsihw,
  });
  const disk = vmDiskSpec({
    diskStorage: body.diskStorage,
    diskSize: body.diskSize,
    diskVolume: body.diskVolume,
    extras,
  });
  const net = [
    `model=${body.netModel}`,
    `bridge=${body.bridge}`,
    body.vlan ? `tag=${body.vlan}` : null,
    body.mac ? `macaddr=${body.mac}` : null,
  ]
    .filter(Boolean)
    .join(",");

  const payload: Record<string, unknown> = {
    vmid: body.vmid,
    name: body.name,
    description: body.description,
    memory: body.memory,
    balloon: body.balloon,
    cores: body.cores,
    sockets: body.sockets ?? 1,
    numa: body.numa ? 1 : 0,
    cpu: body.cpu,
    scsihw: body.scsihw ?? "virtio-scsi-single",
    bios: body.bios,
    machine: body.machine,
    net0: net,
    ostype: body.ostype ?? ostypeFromIso(body.iso ?? "") ?? "l26",
    agent: "1",
  };
  if (body.diskBus === "virtio") payload.virtio0 = disk;
  else if (body.diskBus === "sata") payload.sata0 = disk;
  else if (body.diskBus === "ide") payload.ide0 = disk;
  else payload.scsi0 = disk;
  Object.assign(payload, vmCdromDisks(body.iso, body.iso2));
  if (body.efi) payload.efidisk0 = `${body.diskStorage}:1,efitype=4m,pre-enrolled-keys=1`;
  if (body.tpm) payload.tpmstate0 = `${body.diskStorage}:1,version=v2.0`;

  const t0 = Date.now();
  let hostName = "";
  let started = false;
  let startError: string | undefined;
  let upid: unknown;
  try {
    const result = await withHostClient(params.id, session.user, async (client, host) => {
      hostName = host.name;
      await assertGuestIdentityFree(body.vmid);
      const createUpid = await client.vms.create(body.node, payload as VmCreateParams);
      const done = await completeGuestCreate(client, "vm", body.node, body.vmid, createUpid, Boolean(body.startAfter));
      return { createUpid, ...done };
    });
    upid = result.createUpid;
    started = result.started;
    startError = result.startError;
  } catch (error) {
    notifyTopic("vm.created", {
      level: "error",
      title: "VM fehlgeschlagen",
      message: `VM ${body.vmid} (${body.name}) — fehlgeschlagen: ${error instanceof Error ? error.message : "unbekannt"}`,
      hostId: params.id,
      name: body.name,
      id: String(body.vmid),
      host: hostName,
      node: body.node,
    });
    throw error;
  }

  const ms = Date.now() - t0;
  const suffix = startError ? ` — Start fehlgeschlagen: ${startError}` : ` — fertig in ${durationLabel(ms)}`;
  await writeAuditLog({
    userId: session.user.id,
    ip: await clientIp(),
    action: AUDIT_ACTIONS.VM_CREATED,
    target: `${body.vmid} ${body.name}`,
    hostId: params.id,
    result: "SUCCESS",
    metadata: { upid: typeof upid === "string" ? upid : null, started, startError },
  });
  notifyTopic("vm.created", {
    level: startError ? "warning" : "success",
    title: "VM erstellt",
    message: `VM ${body.vmid} (${body.name})${suffix}`,
    hostId: params.id,
    name: body.name,
    id: String(body.vmid),
    host: hostName,
    node: body.node,
  });
  return json({ upid, started, startError, node: body.node, vmid: body.vmid }, 201);
});
