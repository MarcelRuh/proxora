import { handleRouteError, json } from "@/server/http/respond";
import { listSharedHostsForPeer, requireFederationPeer } from "@/server/services/federation-service";

export async function GET(request: Request) {
  try {
    const peer = await requireFederationPeer(request);
    return json({ hosts: await listSharedHostsForPeer(peer) });
  } catch (error) {
    return handleRouteError(error);
  }
}
