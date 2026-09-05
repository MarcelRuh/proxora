import { handleRouteError, json } from "@/server/http/respond";
import { ValidationError } from "@/lib/errors";
import { networksForHostId } from "@/server/services/guest-ip-settings";
import { assertSharedHost, requireFederationPeer } from "@/server/services/federation-service";

export async function GET(request: Request) {
  try {
    const peer = await requireFederationPeer(request);
    const hostId = new URL(request.url).searchParams.get("hostId")?.trim() ?? "";
    if (!hostId) throw new ValidationError("hostId required");
    await assertSharedHost(peer, hostId, "GET", "/version");
    return json({ networks: await networksForHostId(hostId) });
  } catch (error) {
    return handleRouteError(error);
  }
}
