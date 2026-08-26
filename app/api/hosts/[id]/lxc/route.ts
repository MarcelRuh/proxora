import { z } from "zod";
import { apiRoute } from "@/server/http/api-route";
import { json } from "@/server/http/respond";
import { clientIp } from "@/server/auth/session";
import { writeAuditLog } from "@/server/services/audit-service";
import { AUDIT_ACTIONS } from "@/lib/audit-actions";
import { withHostClient } from "@/server/services/host-service";

const createLxcSchema = z.object({
  node: z.string().min(1),
  vmid: z.number().int().positive(),
  hostname: z.string().min(1),
  password: z.string().optional(),
  sshKeys: z.string().optional(),
  ostemplate: z.string().min(1),
  storage: z.string().min(1),
  diskSize: z.string().min(1),
  cores: z.number().int().positive(),
  memory: z.number().int().positive(),
  swap: z.number().int().min(0).optional(),
  bridge: z.string().min(1),
  vlan: z.number().int().optional(),
  ipv4: z.string().optional(),
  ipv6: z.string().optional(),
  gateway: z.string().optional(),
  nameserver: z.string().optional(),
  searchdomain: z.string().optional(),
  unprivileged: z.boolean().optional(),
  nesting: z.boolean().optional(),
  description: z.string().optional(),
});

export const GET = apiRoute("lxc.view", async (_req, session, params) => {
  const containers = await withHostClient(params.id, session.user, (client) => client.listContainers());
  return json({ containers });
});

export const POST = apiRoute("lxc.create", async (req, session, params) => {
  const body = createLxcSchema.parse(await req.json());
  const netParts = [
    "name=eth0",
    `bridge=${body.bridge}`,
    body.vlan ? `tag=${body.vlan}` : null,
    `ip=${body.ipv4 || "dhcp"}`,
    body.gateway ? `gw=${body.gateway}` : null,
    body.ipv6 ? `ip6=${body.ipv6}` : "ip6=auto",
  ].filter(Boolean);

  const features = [body.nesting ? "nesting=1" : null].filter(Boolean).join(",");

  const upid = await withHostClient(params.id, session.user, (client) =>
    client.lxc.create(body.node, {
      vmid: body.vmid,
      hostname: body.hostname,
      password: body.password,
      "ssh-public-keys": body.sshKeys,
      ostemplate: body.ostemplate,
      rootfs: `${body.storage}:${body.diskSize}`,
      cores: body.cores,
      memory: body.memory,
      swap: body.swap ?? 512,
      net0: netParts.join(","),
      unprivileged: body.unprivileged === false ? 0 : 1,
      features: features || undefined,
      nameserver: body.nameserver,
      searchdomain: body.searchdomain,
      description: body.description,
    }),
  );
  await writeAuditLog({
    userId: session.user.id,
    ip: await clientIp(),
    action: AUDIT_ACTIONS.LXC_CREATED,
    target: `${body.vmid} ${body.hostname}`,
    hostId: params.id,
    result: "SUCCESS",
    metadata: { upid },
  });
  return json({ upid }, 201);
});
