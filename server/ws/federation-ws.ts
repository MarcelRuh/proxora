import type { IncomingMessage } from "node:http";
import { WebSocket } from "ws";
import { logger } from "@/lib/logger";
import { ForbiddenError, NotFoundError, UnauthorizedError } from "@/lib/errors";
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
  try {
    await pipeFederationWebsocket(browser, req);
  } catch (error) {
    logger.warn({ err: error instanceof Error ? error.message : error }, "Federation websocket failed");
    const code =
      error instanceof UnauthorizedError
        ? 4401
        : error instanceof ForbiddenError
          ? 4403
          : error instanceof NotFoundError
            ? 4404
            : 1011;
    const reason = (error instanceof Error ? error.message : "Peer console failed").slice(0, 80);
    try {
      browser.close(code, reason);
    } catch {
      /* ignore */
    }
  }
}

async function pipeFederationWebsocket(browser: WebSocket, req: IncomingMessage) {
  const url = new URL(req.url ?? "", "http://localhost");
  const token = bearer(req);
  const peer = await findPeerByInboundToken(token);
  if (!peer || peer.kind !== WireguardPeerKind.PROXORA) {
    throw new UnauthorizedError("Unknown federation peer");
  }
  const remoteHostId = url.searchParams.get("remoteHostId") ?? "";
  const path = url.searchParams.get("path") ?? "";
  if (!remoteHostId || !path.startsWith("/")) {
    throw new ForbiddenError("Invalid federation websocket");
  }
  const query: Record<string, string> = {};
  url.searchParams.forEach((value, key) => {
    if (key === "remoteHostId" || key === "path") return;
    query[key] = value;
  });
  const host = await assertSharedHost(peer, remoteHostId, "GET", path, { query });
  const proxmox = await clientForHost(host);
  const wsUrl = proxmox.http.websocketUrl(path, query);
  const headers = await proxmox.http.authHeaders();
  const remote = new WebSocket(wsUrl, ["binary"], {
    headers,
    rejectUnauthorized: !host.allowInsecureTls,
    perMessageDeflate: false,
  } as import("ws").ClientOptions);

  const pending: Buffer[] = [];
  let upstreamOpen = false;

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

  const sendUp = (data: Buffer) => {
    if (upstreamOpen && remote.readyState === WebSocket.OPEN) {
      remote.send(data);
      return;
    }
    pending.push(data);
  };

  remote.on("open", () => {
    upstreamOpen = true;
    for (const chunk of pending.splice(0)) {
      if (remote.readyState === WebSocket.OPEN) remote.send(chunk);
    }
  });
  remote.on("message", (data) => {
    if (browser.readyState === WebSocket.OPEN) browser.send(wsPayloadToBuffer(data as Buffer));
  });
  browser.on("message", (data) => {
    sendUp(wsPayloadToBuffer(data as Buffer));
  });
  remote.on("close", (code, reason) => closeBoth(code, reason.toString()));
  browser.on("close", (code, reason) => closeBoth(code, reason.toString()));
  remote.on("error", (err) => {
    logger.warn({ err: err.message }, "Federation PVE websocket failed");
    closeBoth(1011, "Peer console failed");
  });
  browser.on("error", () => closeBoth(1011, "Peer console failed"));
}
