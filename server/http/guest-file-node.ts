import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { SESSION_COOKIE } from "@/lib/env";
import { isGuestFileTransferPath, parseGuestUploadPlan } from "@/lib/guest-file-http";
import { userHasAnyPermission } from "@/lib/permissions";
import { AUDIT_ACTIONS } from "@/lib/audit-actions";
import { ForbiddenError, NotFoundError, UnauthorizedError, ValidationError } from "@/lib/errors";
import { assertGuestAccess, getSessionFromToken } from "@/server/auth/session-core";
import { assertSameOrigin, handleRouteError } from "@/server/http/respond";
import { takeGuestTransferTicket } from "@/server/services/guest-file-tickets";
import { getHostOrThrow } from "@/server/services/host-service";
import { writeAuditLog } from "@/server/services/audit-service";
import { streamGuestFileDownload, streamGuestFileUpload } from "@/server/services/guest-files";

const HOST_FILES =
  /^\/api\/hosts\/([^/]+)\/(vms|lxc)\/([^/]+)\/([^/]+)\/files\/(upload|download)\/?$/;

function cookieValue(req: IncomingMessage, name: string): string | undefined {
  const raw = req.headers.cookie ?? "";
  for (const part of raw.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return undefined;
}

function nodeToHeaderRequest(req: IncomingMessage): Request {
  const host = req.headers.host || "localhost";
  const forwarded = String(req.headers["x-forwarded-proto"] ?? "")
    .split(",")[0]
    ?.trim();
  const proto = forwarded || "http";
  const url = `${proto}://${host}${req.url ?? "/"}`;
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (!value) continue;
    headers.set(key, Array.isArray(value) ? value.join(", ") : value);
  }
  return new Request(url, { method: req.method, headers });
}

function clientIp(req: IncomingMessage): string | undefined {
  const forwarded = String(req.headers["x-forwarded-for"] ?? "")
    .split(",")[0]
    ?.trim();
  return forwarded || req.socket.remoteAddress || undefined;
}

async function sendWebResponse(res: ServerResponse, response: Response) {
  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    headers[key] = value;
  });
  res.writeHead(response.status, headers);
  if (!response.body) {
    res.end();
    return;
  }
  const node = Readable.fromWeb(response.body as import("node:stream/web").ReadableStream<Uint8Array>);
  node.pipe(res);
}

export function matchHostFileTransfer(req: IncomingMessage): {
  hostId: string;
  kind: "vm" | "lxc";
  node: string;
  vmid: string;
  mode: "upload" | "download";
} | null {
  const pathname = (req.url ?? "").split("?")[0] ?? "";
  if (!isGuestFileTransferPath(pathname)) return null;
  const match = HOST_FILES.exec(pathname.replace(/\/+$/, "") || "/");
  if (!match) return null;
  return {
    hostId: decodeURIComponent(match[1] ?? ""),
    kind: match[2] === "lxc" ? "lxc" : "vm",
    node: decodeURIComponent(match[3] ?? ""),
    vmid: match[4] ?? "",
    mode: match[5] === "upload" ? "upload" : "download",
  };
}

export async function handleNodeGuestFileTransfer(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const parsed = matchHostFileTransfer(req);
  if (!parsed) return false;
  const method = (req.method ?? "GET").toUpperCase();
  if (parsed.mode === "upload" && method !== "PUT") return false;
  if (parsed.mode === "download" && method !== "GET" && method !== "HEAD") return false;

  req.socket?.setNoDelay?.(true);
  req.socket?.setTimeout?.(0);

  try {
    const request = nodeToHeaderRequest(req);
    assertSameOrigin(request);
    const session = await getSessionFromToken(cookieValue(req, SESSION_COOKIE));
    if (!session) throw new UnauthorizedError();
    const permission = parsed.kind === "vm" ? "vm.files" : "lxc.files";
    if (!userHasAnyPermission(session.user, [permission], parsed.hostId)) throw new ForbiddenError();
    const vmid = Number(parsed.vmid);
    if (!Number.isInteger(vmid) || vmid < 1) throw new ValidationError("Invalid VMID");
    const ticketId = new URL(request.url).searchParams.get("ticket")?.trim() ?? "";
    if (!ticketId || ticketId.length > 80) throw new NotFoundError("Transfer abgelaufen oder ungültig");
    const ticket = takeGuestTransferTicket(ticketId, session.user.id, parsed.mode);
    if (
      ticket.hostId !== parsed.hostId ||
      ticket.kind !== parsed.kind ||
      ticket.node !== parsed.node ||
      ticket.vmid !== vmid
    ) {
      throw new NotFoundError("Transfer abgelaufen oder ungültig");
    }
    assertGuestAccess(session.user, parsed.hostId, parsed.kind, ticket.vmid);
    if (parsed.mode === "download" && method === "HEAD") {
      res.writeHead(200, { "Cache-Control": "no-store" });
      res.end();
      return true;
    }
    const host = await getHostOrThrow(parsed.hostId, session.user);
    const ip = clientIp(req);
    const meta = { path: ticket.path, sshHost: ticket.target, sshUser: ticket.username, mode: ticket.mode };
    try {
      if (parsed.mode === "upload") {
        const plan = parseGuestUploadPlan({
          sizeHeader: Array.isArray(req.headers["x-proxora-upload-size"])
            ? req.headers["x-proxora-upload-size"][0]
            : (req.headers["x-proxora-upload-size"] ?? null),
          offsetHeader: Array.isArray(req.headers["x-proxora-upload-offset"])
            ? req.headers["x-proxora-upload-offset"][0]
            : (req.headers["x-proxora-upload-offset"] ?? null),
          contentLength: Array.isArray(req.headers["content-length"])
            ? req.headers["content-length"][0]
            : (req.headers["content-length"] ?? null),
        });
        const result = await streamGuestFileUpload(host, {
          kind: ticket.kind,
          vmid: ticket.vmid,
          target: ticket.target,
          port: ticket.port,
          username: ticket.username,
          password: ticket.password,
          privateKey: ticket.privateKey,
          passphrase: ticket.passphrase,
          path: ticket.path,
          body: req,
          contentLength: Array.isArray(req.headers["content-length"])
            ? req.headers["content-length"][0]
            : (req.headers["content-length"] ?? null),
          expectedSize: plan.expectedSize,
          offset: plan.offset,
        });
        await writeAuditLog({
          userId: session.user.id,
          ip,
          action: AUDIT_ACTIONS.GUEST_FILES_WRITE,
          target: `${parsed.kind.toUpperCase()} ${vmid} ${ticket.path}`,
          hostId: parsed.hostId,
          result: "SUCCESS",
          metadata: { ...meta, size: result.size },
        });
        const buf = Buffer.from(JSON.stringify({ ...result, via: "sftp" }));
        res.writeHead(200, { "Content-Type": "application/json", "Content-Length": buf.length });
        res.end(buf);
        return true;
      }
      const response = await streamGuestFileDownload(host, {
        kind: ticket.kind,
        vmid: ticket.vmid,
        target: ticket.target,
        port: ticket.port,
        username: ticket.username,
        password: ticket.password,
        privateKey: ticket.privateKey,
        passphrase: ticket.passphrase,
        path: ticket.path,
      });
      await writeAuditLog({
        userId: session.user.id,
        ip,
        action: AUDIT_ACTIONS.GUEST_FILES_DOWNLOAD,
        target: `${parsed.kind.toUpperCase()} ${vmid} ${ticket.path}`,
        hostId: parsed.hostId,
        result: "SUCCESS",
        metadata: meta,
      });
      await sendWebResponse(res, response);
      return true;
    } catch (error) {
      await writeAuditLog({
        userId: session.user.id,
        ip,
        action: parsed.mode === "upload" ? AUDIT_ACTIONS.GUEST_FILES_WRITE : AUDIT_ACTIONS.GUEST_FILES_DOWNLOAD,
        target: `${parsed.kind.toUpperCase()} ${vmid} ${ticket.path}`,
        hostId: parsed.hostId,
        result: "FAILURE",
        error: error instanceof Error ? error.message : String(error),
        metadata: meta,
      });
      throw error;
    }
  } catch (error) {
    const response = handleRouteError(error);
    await sendWebResponse(res, response);
    return true;
  }
}
