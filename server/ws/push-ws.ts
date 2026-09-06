import type { IncomingMessage } from "node:http";
import { WebSocket, type WebSocketServer } from "ws";
import { SESSION_COOKIE } from "@/lib/env";
import { PUSH_WS_PATH } from "@/lib/push-payload";
import { logger } from "@/lib/logger";
import { getSessionFromToken } from "@/server/auth/session-core";
import { userReceivesInboxPush } from "@/server/services/inbox-service";
import { cookieValue } from "@/server/ws/request-cookie";
import { addPushClient, removePushClient } from "@/server/ws/push-hub";

export { PUSH_WS_PATH };

const PING_MS = 25_000;

export function attachPushSocket(wss: WebSocketServer) {
  wss.on("connection", (ws, req) => {
    void handlePushConnection(ws, req);
  });
}

async function handlePushConnection(ws: WebSocket, req: IncomingMessage) {
  const session = await getSessionFromToken(cookieValue(req, SESSION_COOKIE));
  if (!session || !userReceivesInboxPush(session.user, null)) {
    ws.close(4401, "Unauthorized");
    return;
  }

  const client = { ws, user: session.user };
  addPushClient(client);

  const ping = setInterval(() => {
    if (ws.readyState !== WebSocket.OPEN) return;
    try {
      ws.send(JSON.stringify({ type: "ping" }));
    } catch {
      ws.terminate();
    }
  }, PING_MS);

  ws.on("close", () => {
    clearInterval(ping);
    removePushClient(client);
  });
  ws.on("error", () => {
    clearInterval(ping);
    removePushClient(client);
  });

  logger.debug({ userId: session.user.id }, "Push socket connected");
}
