import type { WebSocket } from "ws";
import type { SessionUser } from "@/server/auth/session-core";
import { userReceivesInboxPush } from "@/server/services/inbox-service";
import type { PushPayload } from "@/lib/push-payload";

type PushClient = { ws: WebSocket; user: SessionUser };

const clients = new Set<PushClient>();

export function addPushClient(client: PushClient) {
  clients.add(client);
}

export function removePushClient(client: PushClient) {
  clients.delete(client);
}

export function broadcastPush(payload: PushPayload, hostId: string | null) {
  const body = JSON.stringify({ type: "event", ...payload });
  for (const client of clients) {
    if (client.ws.readyState !== client.ws.OPEN) continue;
    if (!userReceivesInboxPush(client.user, hostId)) continue;
    try {
      client.ws.send(body);
    } catch {
      clients.delete(client);
    }
  }
}
