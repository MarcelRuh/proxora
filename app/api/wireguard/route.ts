import { z } from "zod";
import { apiRoute } from "@/server/http/api-route";
import { json } from "@/server/http/respond";
import { ValidationError } from "@/lib/errors";
import {
  addGatewayPeer,
  createProxoraPeer,
  deletePeer,
  importWireguardInvite,
  inviteForPeer,
  listPeersWithShares,
  loadWireguardInterface,
  patchWireguardInterface,
  publicInterface,
  setPeerShares,
} from "@/server/services/wireguard-service";

export const GET = apiRoute("peers.manage", async () => {
  const cfg = await loadWireguardInterface();
  return json({
    interface: publicInterface(cfg),
    peers: await listPeersWithShares(),
  });
});

export const PATCH = apiRoute("peers.manage", async (req) => {
  const iface = await patchWireguardInterface(await req.json());
  return json({ interface: iface });
});

export const POST = apiRoute("peers.manage", async (req) => {
  const body = z
    .object({
      action: z.enum(["create-peer", "import", "gateway", "invite", "shares", "delete-peer"]),
      name: z.string().optional(),
      invite: z.string().optional(),
      peerId: z.string().optional(),
      publicKey: z.string().optional(),
      endpoint: z.string().optional(),
      allowedIPs: z.string().optional(),
      shares: z.array(z.object({ hostId: z.string(), level: z.string() })).optional(),
    })
    .parse(await req.json());

  if (body.action === "create-peer") {
    const name = body.name?.trim();
    if (!name) throw new ValidationError("Name required");
    const created = await createProxoraPeer(name);
    return json(created, 201);
  }
  if (body.action === "import") {
    if (!body.invite) throw new ValidationError("Invite required");
    return json(await importWireguardInvite(body.invite));
  }
  if (body.action === "gateway") {
    return json(
      await addGatewayPeer({
        name: body.name,
        publicKey: body.publicKey,
        endpoint: body.endpoint,
        allowedIPs: body.allowedIPs,
      }),
      201,
    );
  }
  if (body.action === "invite") {
    if (!body.peerId) throw new ValidationError("peerId required");
    return json({ invite: await inviteForPeer(body.peerId) });
  }
  if (body.action === "shares") {
    if (!body.peerId) throw new ValidationError("peerId required");
    return json({ peers: await setPeerShares(body.peerId, body.shares ?? []) });
  }
  if (body.action === "delete-peer") {
    if (!body.peerId) throw new ValidationError("peerId required");
    await deletePeer(body.peerId);
    return json({ ok: true });
  }
  return json({ error: "Unknown action" }, 400);
});
