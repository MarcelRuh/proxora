import type { IncomingMessage } from "node:http";
import { WebSocket } from "ws";
import { logger } from "@/lib/logger";
import { findPeerByInboundToken } from "@/server/services/wireguard-service";
import { assertSharedHost } from "@/server/services/federation-service";
import { clientForHost } from "@/server/services/host-service";
import { WireguardPeerKind } from "@prisma/client";
import { wsPayloadToBuffer } from "@/lib/vnc-handshake";

function bearer(req: IncomingMessage): string {
  const header = req.headers.authorization ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match?.[1]?.trim() ?? "";
}

export async function handleFederationWebsocket(browser: WebSocket, req: IncomingMessage) {
  const url = new URL(req.url ?? "", "http://localhost");
  const token = bearer(req);
  const peer = await findPeerByInboundToken(token);
  if (!peer || peer.kind !== WireguardPeerKind.PROXORA) {
    browser.close(4401, "Unauthorized");
    return;
  }
  const remoteHostId = url.searchParams.get("remoteHostId") ?? "";
  const path = url.searchParams.get("path") ?? "";
  if (!remoteHostId || !path.startsWith("/")) {
    browser.close(4400, "Invalid federation websocket");
    return;
  }
  const host = await assertSharedHost(peer, remoteHostId, "GET", path);
  const query: Record<string, string> = {};
  url.searchParams.forEach((value, key) => {
    if (key === "remoteHostId" || key === "path") return;
    query[key] = value;
  });
  const proxmox = await clientForHost(host);
  const wsUrl = proxmox.http.websocketUrl(path, query);
  const headers = await proxmox.http.authHeaders();
  const remote = new WebSocket(wsUrl, ["binary"], {
    headers,
    rejectUnauthorized: !host.allowInsecureTls,
    perMessageDeflate: false,
  } as import("ws").ClientOptions);

  const closeBoth = (code?: number, reason?: string) => {
    try {
      remote.close(code);
    } catch {
      /* ignore */
    }
    try {
      browser.close(code, reason);
    } catch {
      /* ignore */
    }
  };

  remote.on("open", () => {
    /* pipe */
  });
  remote.on("message", (data) => {
    if (browser.readyState === WebSocket.OPEN) browser.send(data as Buffer);
  });
  browser.on("message", (data) => {
    if (remote.readyState === WebSocket.OPEN) remote.send(wsPayloadToBuffer(data as Buffer));
  });
  remote.on("close", (code, reason) => closeBoth(code, reason.toString()));
  browser.on("close", (code, reason) => closeBoth(code, reason.toString()));
  remote.on("error", (err) => {
    logger.warn({ err: err.message }, "Federation PVE websocket failed");
    closeBoth(1011, "Peer console failed");
  });
}
