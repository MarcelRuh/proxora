import type { IncomingMessage } from "node:http";
import { PassThrough } from "node:stream";
import { WebSocket, type WebSocketServer } from "ws";
import { SESSION_COOKIE } from "@/lib/env";
import { isGuestFileUploadWsPath, parseGuestUploadPrefix } from "@/lib/guest-file-http";
import { AUDIT_ACTIONS } from "@/lib/audit-actions";
import { ForbiddenError, NotFoundError, UnauthorizedError, ValidationError } from "@/lib/errors";
import { userHasAnyPermission } from "@/lib/permissions";
import { wsPayloadToBuffer } from "@/lib/vnc-handshake";
import { logger } from "@/lib/logger";
import { assertGuestAccess, getSessionFromToken } from "@/server/auth/session-core";
import { isAllowedOrigin } from "@/server/http/respond";
import { takeGuestTransferTicket } from "@/server/services/guest-file-tickets";
import { getHostOrThrow } from "@/server/services/host-service";
import { writeAuditLog } from "@/server/services/audit-service";
import { streamGuestFileUpload } from "@/server/services/guest-files";

function cookieValue(req: IncomingMessage, name: string): string | undefined {
  const raw = req.headers.cookie ?? "";
  for (const part of raw.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return undefined;
}

function headerRequest(req: IncomingMessage): Request {
  const host = req.headers.host || "localhost";
  const forwarded = String(req.headers["x-forwarded-proto"] ?? "")
    .split(",")[0]
    ?.trim();
  const proto = forwarded || "http";
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (!value) continue;
    headers.set(key, Array.isArray(value) ? value.join(", ") : value);
  }
  return new Request(`${proto}://${host}${req.url ?? "/"}`, { method: "GET", headers });
}

function clientIp(req: IncomingMessage): string | undefined {
  const forwarded = String(req.headers["x-forwarded-for"] ?? "")
    .split(",")[0]
    ?.trim();
  return forwarded || req.socket.remoteAddress || undefined;
}

function sendJson(ws: WebSocket, payload: Record<string, unknown>) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
}

function closeSoon(ws: WebSocket, code: number, reason: string) {
  try {
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
      ws.close(code, reason.slice(0, 120));
    }
  } catch {
    /* ignore */
  }
}

export function attachGuestFileUpload(wss: WebSocketServer) {
  wss.on("connection", (ws, req) => {
    void handleUploadSocket(ws, req);
  });
}

async function handleUploadSocket(ws: WebSocket, req: IncomingMessage) {
  const url = new URL(req.url ?? "", "http://localhost");
  if (!isGuestFileUploadWsPath(url.pathname)) {
    closeSoon(ws, 4404, "Not found");
    return;
  }

  req.socket?.setNoDelay?.(true);
  req.socket?.setTimeout?.(0);

  const origin = req.headers.origin;
  const request = headerRequest(req);
  if (!origin || !isAllowedOrigin(request, origin)) {
    closeSoon(ws, 4403, "Invalid origin");
    return;
  }

  let session;
  try {
    session = await getSessionFromToken(cookieValue(req, SESSION_COOKIE));
  } catch {
    closeSoon(ws, 4401, "Unauthorized");
    return;
  }
  if (!session) {
    closeSoon(ws, 4401, "Unauthorized");
    return;
  }

  const ticketId = url.searchParams.get("ticket")?.trim() ?? "";
  if (!ticketId || ticketId.length > 80) {
    closeSoon(ws, 4404, "Transfer abgelaufen oder ungültig");
    return;
  }

  let ticket;
  try {
    ticket = takeGuestTransferTicket(ticketId, session.user.id, "upload");
  } catch {
    closeSoon(ws, 4404, "Transfer abgelaufen oder ungültig");
    return;
  }

  const permission = ticket.kind === "vm" ? "vm.files" : "lxc.files";
  if (!userHasAnyPermission(session.user, [permission], ticket.hostId)) {
    closeSoon(ws, 4403, "Forbidden");
    return;
  }
  try {
    assertGuestAccess(session.user, ticket.hostId, ticket.kind, ticket.vmid);
  } catch {
    closeSoon(ws, 4403, "Forbidden");
    return;
  }

  const ip = clientIp(req);
  const meta = { path: ticket.path, sshHost: ticket.target, sshUser: ticket.username, mode: ticket.mode, via: "ws" };
  const body = new PassThrough({ highWaterMark: 4 * 1024 * 1024 });
  const socket = (ws as unknown as { _socket?: { pause?: () => void; resume?: () => void } })._socket;
  let inputClosed = false;
  let started = false;
  let accepted = false;
      let startResolve: ((plan: { size: number; offset: number; prefix: string | null }) => void) | null = null;
  let startReject: ((error: unknown) => void) | null = null;
  const startPromise = new Promise<{ size: number; offset: number; prefix: string | null }>((resolve, reject) => {
    startResolve = resolve;
    startReject = reject;
  });

  const failBody = (error: unknown) => {
    if (inputClosed) return;
    inputClosed = true;
    const err = error instanceof Error ? error : new Error(String(error));
    try {
      body.destroy(err);
    } catch {
      /* ignore */
    }
    startReject?.(err);
  };

  body.on("drain", () => {
    try {
      socket?.resume?.();
    } catch {
      /* ignore */
    }
  });

  ws.on("message", (data, isBinary) => {
    if (inputClosed) return;
    if (!accepted) {
      if (isBinary) return;
      let msg: { type?: string; size?: number; offset?: number; prefix?: string } = {};
      try {
        msg = JSON.parse(wsPayloadToBuffer(data as Buffer | ArrayBuffer | Buffer[] | string).toString("utf8")) as typeof msg;
      } catch {
        failBody(new ValidationError("Ungültige Upload-Nachricht"));
        return;
      }
      if (msg.type !== "start") return;
      const size = Math.floor(Number(msg.size));
      const offset = Math.floor(Number(msg.offset) || 0);
      if (!Number.isFinite(size) || size < 0 || size > Number.MAX_SAFE_INTEGER || offset < 0 || offset > size) {
        failBody(new ValidationError("Ungültiger Upload-Plan"));
        return;
      }
      accepted = true;
      startResolve?.({ size, offset, prefix: parseGuestUploadPrefix(msg.prefix ?? "") });
      return;
    }
    if (!isBinary) {
      let msg: { type?: string } = {};
      try {
        msg = JSON.parse(wsPayloadToBuffer(data as Buffer | ArrayBuffer | Buffer[] | string).toString("utf8")) as {
          type?: string;
        };
      } catch {
        failBody(new ValidationError("Ungültige Upload-Nachricht"));
        return;
      }
      if (msg.type === "end") {
        inputClosed = true;
        body.end();
      }
      return;
    }
    const chunk = wsPayloadToBuffer(data as Buffer | ArrayBuffer | Buffer[] | string);
    if (!chunk.byteLength) return;
    try {
      if (!body.write(chunk)) socket?.pause?.();
    } catch (error) {
      failBody(error);
    }
  });

  ws.on("error", (error) => failBody(error));
  ws.on("close", () => {
    if (!inputClosed) failBody(new ValidationError("Upload abgebrochen"));
  });

  try {
    const host = await getHostOrThrow(ticket.hostId, session.user);
    sendJson(ws, { type: "ready" });
    const plan = await Promise.race([
      startPromise,
      new Promise<{ size: number; offset: number; prefix: string | null }>((_, reject) => {
        setTimeout(() => reject(new ValidationError("Upload-Start ausbleibend")), 20_000);
      }),
    ]);
    started = true;
    const upload = streamGuestFileUpload(host, {
      kind: ticket.kind,
      vmid: ticket.vmid,
      target: ticket.target,
      port: ticket.port,
      username: ticket.username,
      password: ticket.password,
      privateKey: ticket.privateKey,
      passphrase: ticket.passphrase,
      path: ticket.path,
      body,
      contentLength: null,
      expectedSize: plan.size,
      offset: plan.offset,
      prefix: plan.prefix,
    });
    sendJson(ws, { type: "go", offset: plan.offset, size: plan.size });
    const result = await upload;
    await writeAuditLog({
      userId: session.user.id,
      ip,
      action: AUDIT_ACTIONS.GUEST_FILES_WRITE,
      target: `${ticket.kind.toUpperCase()} ${ticket.vmid} ${ticket.path}`,
      hostId: ticket.hostId,
      result: "SUCCESS",
      metadata: { ...meta, size: result.size },
    });
    sendJson(ws, { type: "done", ...result });
  } catch (error) {
    failBody(error);
    const message =
      error instanceof ForbiddenError ||
      error instanceof NotFoundError ||
      error instanceof UnauthorizedError ||
      error instanceof ValidationError
        ? error.message
        : "Upload fehlgeschlagen";
    if (started) {
      await writeAuditLog({
        userId: session.user.id,
        ip,
        action: AUDIT_ACTIONS.GUEST_FILES_WRITE,
        target: `${ticket.kind.toUpperCase()} ${ticket.vmid} ${ticket.path}`,
        hostId: ticket.hostId,
        result: "FAILURE",
        error: error instanceof Error ? error.message : String(error),
        metadata: meta,
      }).catch((auditErr) => logger.warn({ err: auditErr }, "Guest file WS audit failed"));
    }
    sendJson(ws, { type: "error", error: message });
    closeSoon(ws, 1011, message);
  }
}
