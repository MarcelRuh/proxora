import { z } from "zod";
import { apiRoute } from "@/server/http/api-route";
import { json } from "@/server/http/respond";
import { clientIp } from "@/server/auth/session";
import { writeAuditLog } from "@/server/services/audit-service";
import { AUDIT_ACTIONS } from "@/lib/audit-actions";
import { withHostClient } from "@/server/services/host-service";
import { filterGuestsForUser } from "@/server/auth/session-core";
import { buildLxcNet0, compactProxmoxBody, normalizeLxcCidr } from "@/lib/lxc-net";
import { completeGuestCreate } from "@/server/services/guest-start";
import { notifyTopic } from "@/server/notifications/dispatch";
import { durationLabel } from "@/lib/duration";
import { ipv4Host } from "@/lib/create-ip";
import { assertGuestIdentityFree } from "@/server/services/guest-ips";
import type { LxcCreateParams } from "@/server/proxmox/lxc";

export const maxDuration = 800;

const createLxcSchema = z.object({
  node: z.string().min(1, "Node fehlt"),
  vmid: z.number().int().positive("CT-ID fehlt"),
  hostname: z.string().min(1, "Hostname fehlt"),
  password: z.string().min(5, "Passwort mindestens 5 Zeichen"),
  ostemplate: z.string().min(1, "Template fehlt"),
  storage: z.string().min(1, "Storage fehlt"),
  diskSize: z.string().min(1),
  cores: z.number().int().positive(),
  memory: z.number().int().positive(),
  swap: z.number().int().min(0).optional(),
  bridge: z.string().min(1, "Bridge fehlt"),
  vlan: z.number().int().optional(),
  ipv4: z.string().optional(),
  ipv6: z.string().optional(),
  gateway: z.string().optional(),
  nameserver: z.string().optional(),
  searchdomain: z.string().optional(),
  unprivileged: z.boolean().optional(),
  nesting: z.boolean().optional(),
  description: z.string().optional(),
  startAfter: z.boolean().optional(),
});

export const GET = apiRoute("lxc.view", async (_req, session, params) => {
  const containers = await withHostClient(params.id, session.user, async (client) => {
    return filterGuestsForUser(session.user, params.id, "lxc", await client.listContainers());
  });
  return json({ containers });
});

export const POST = apiRoute("lxc.create", async (req, session, params) => {
  const body = createLxcSchema.parse(await req.json());
  const ipMode = !body.ipv4 || body.ipv4 === "dhcp" ? "dhcp" : "static";
  const net0 = buildLxcNet0({
    bridge: body.bridge,
    vlan: body.vlan,
    mode: ipMode,
    cidr: ipMode === "static" ? normalizeLxcCidr(body.ipv4 ?? "") : undefined,
    gateway: ipMode === "static" ? body.gateway : undefined,
  });
  const features = [body.nesting === false ? null : "nesting=1"].filter(Boolean).join(",");
  const staticIp = ipMode === "static" ? ipv4Host(body.ipv4 ?? "") : null;

  const t0 = Date.now();
  let hostName = "";
  let started = false;
  let startError: string | undefined;
  let upid: unknown;
  try {
    const result = await withHostClient(params.id, session.user, async (client, host) => {
      hostName = host.name;
      await assertGuestIdentityFree(body.vmid, staticIp);
      const createUpid = await client.lxc.create(
        body.node,
        compactProxmoxBody({
          vmid: body.vmid,
          hostname: body.hostname,
          password: body.password,
          ostemplate: body.ostemplate,
          rootfs: `${body.storage}:${body.diskSize}`,
          cores: body.cores,
          memory: body.memory,
          swap: body.swap ?? 512,
          net0,
          unprivileged: body.unprivileged === false ? 0 : 1,
          features: features || undefined,
          nameserver: body.nameserver,
          searchdomain: body.searchdomain,
          description: body.description,
        }) as LxcCreateParams,
      );
      const done = await completeGuestCreate(client, "lxc", body.node, body.vmid, createUpid, Boolean(body.startAfter));
      return { createUpid, ...done };
    });
    upid = result.createUpid;
    started = result.started;
    startError = result.startError;
  } catch (error) {
    notifyTopic("lxc.created", {
      level: "error",
      title: "Container fehlgeschlagen",
      message: `LXC ${body.vmid} (${body.hostname}) — fehlgeschlagen: ${error instanceof Error ? error.message : "unbekannt"}`,
      hostId: params.id,
      name: body.hostname,
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
    action: AUDIT_ACTIONS.LXC_CREATED,
    target: `${body.vmid} ${body.hostname}`,
    hostId: params.id,
    result: "SUCCESS",
    metadata: { upid: typeof upid === "string" ? upid : null, started, startError },
  });
  notifyTopic("lxc.created", {
    level: startError ? "warning" : "success",
    title: "Container erstellt",
    message: `LXC ${body.vmid} (${body.hostname})${suffix}`,
    hostId: params.id,
    name: body.hostname,
    id: String(body.vmid),
    host: hostName,
    node: body.node,
  });
  return json({ upid, started, startError, node: body.node, vmid: body.vmid }, 201);
});
