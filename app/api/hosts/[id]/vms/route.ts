import { z } from "zod";
import { apiRoute } from "@/server/http/api-route";
import { json } from "@/server/http/respond";
import { clientIp } from "@/server/auth/session";
import { writeAuditLog } from "@/server/services/audit-service";
import { AUDIT_ACTIONS } from "@/lib/audit-actions";
import { withHostClient } from "@/server/services/host-service";
import type { VmCreateParams } from "@/server/proxmox/vms";

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
  scsihw: z.string().optional(),
  iso: z.string().optional(),
  diskStorage: z.string().min(1),
  diskSize: z.string().min(1),
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
});

export const GET = apiRoute("vm.view", async (_req, session, params) => {
  const vms = await withHostClient(params.id, session.user, (client) => client.listVms());
  return json({ vms });
});

export const POST = apiRoute("vm.create", async (req, session, params) => {
  const body = createVmSchema.parse(await req.json());
  const extras: string[] = [];
  if (body.cache) extras.push(`cache=${body.cache}`);
  if (body.discard) extras.push("discard=on");
  if (body.ssd) extras.push("ssd=1");
  const disk = `${body.diskStorage}:${body.diskSize}${extras.length ? `,${extras.join(",")}` : ""}`;
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
    ostype: body.ostype ?? "l26",
  };
  if (body.diskBus === "virtio") payload.virtio0 = disk;
  else if (body.diskBus === "sata") payload.sata0 = disk;
  else if (body.diskBus === "ide") payload.ide0 = disk;
  else payload.scsi0 = disk;
  if (body.iso) payload.ide2 = `${body.iso},media=cdrom`;
  if (body.efi) payload.efidisk0 = `${body.diskStorage}:1,efitype=4m,pre-enrolled-keys=1`;
  if (body.tpm) payload.tpmstate0 = `${body.diskStorage}:1,version=v2.0`;

  const upid = await withHostClient(params.id, session.user, (client) =>
    client.vms.create(body.node, payload as VmCreateParams),
  );
  await writeAuditLog({
    userId: session.user.id,
    ip: await clientIp(),
    action: AUDIT_ACTIONS.VM_CREATED,
    target: `${body.vmid} ${body.name}`,
    hostId: params.id,
    result: "SUCCESS",
    metadata: { upid },
  });
  return json({ upid }, 201);
});
