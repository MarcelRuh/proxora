import { z } from "zod";
import { handleRouteError, json } from "@/server/http/respond";
import { applyIncomingPeerUpdate } from "@/server/services/peer-update";
import { requireFederationPeer } from "@/server/services/federation-service";
import { requestPeerSync } from "@/server/services/peer-sync";

const schema = z.object({
  updating: z.boolean(),
  from: z.string().max(32).optional().nullable(),
  to: z.string().max(32).optional().nullable(),
});

export async function POST(request: Request) {
  try {
    const peer = await requireFederationPeer(request);
    const body = schema.parse(await request.json());
    await applyIncomingPeerUpdate(peer, body);
    if (!body.updating) requestPeerSync();
    return json({ ok: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
