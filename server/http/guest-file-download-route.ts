import { apiRoute } from "@/server/http/api-route";
import { json } from "@/server/http/respond";
import { clientIp } from "@/server/auth/session";
import { writeAuditLog } from "@/server/services/audit-service";
import { AUDIT_ACTIONS } from "@/lib/audit-actions";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { assertGuestAccess } from "@/server/auth/session-core";
import { getHostOrThrow } from "@/server/services/host-service";
import { takeGuestTransferTicket, type GuestTransferTicket } from "@/server/services/guest-file-tickets";
import { streamGuestFileDownload, streamGuestFileUpload } from "@/server/services/guest-files";

function auditMeta(ticket: GuestTransferTicket) {
  return { path: ticket.path, sshHost: ticket.target, sshUser: ticket.username, mode: ticket.mode };
}

export function guestFileDownloadRoute(kind: "vm" | "lxc") {
  const permission = kind === "vm" ? "vm.files" : "lxc.files";
  return apiRoute(permission, async (req, session, params) => {
    const vmid = Number(params.vmid);
    if (!Number.isInteger(vmid) || vmid < 1) throw new ValidationError("Invalid VMID");
    assertGuestAccess(session.user, params.id, kind, vmid);
    const ticketId = new URL(req.url).searchParams.get("ticket")?.trim() ?? "";
    if (!ticketId || ticketId.length > 80) throw new NotFoundError("Transfer abgelaufen oder ungültig");
    const ticket = takeGuestTransferTicket(ticketId, session.user.id, "download");
    if (ticket.hostId !== params.id || ticket.kind !== kind || ticket.node !== params.node || ticket.vmid !== vmid) {
      throw new NotFoundError("Transfer abgelaufen oder ungültig");
    }
    const host = await getHostOrThrow(params.id, session.user);
    const ip = await clientIp();
    try {
      const response = await streamGuestFileDownload(host, {
        kind: ticket.kind,
        vmid: ticket.vmid,
        target: ticket.target,
        port: ticket.port,
        username: ticket.username,
        password: ticket.password,
        path: ticket.path,
      });
      await writeAuditLog({
        userId: session.user.id,
        ip,
        action: AUDIT_ACTIONS.GUEST_FILES_DOWNLOAD,
        target: `${kind.toUpperCase()} ${vmid} ${ticket.path}`,
        hostId: params.id,
        result: "SUCCESS",
        metadata: auditMeta(ticket),
      });
      return response;
    } catch (error) {
      await writeAuditLog({
        userId: session.user.id,
        ip,
        action: AUDIT_ACTIONS.GUEST_FILES_DOWNLOAD,
        target: `${kind.toUpperCase()} ${vmid} ${ticket.path}`,
        hostId: params.id,
        result: "FAILURE",
        error: error instanceof Error ? error.message : String(error),
        metadata: auditMeta(ticket),
      });
      throw error;
    }
  });
}

export function guestFileUploadRoute(kind: "vm" | "lxc") {
  const permission = kind === "vm" ? "vm.files" : "lxc.files";
  return apiRoute(permission, async (req, session, params) => {
    const vmid = Number(params.vmid);
    if (!Number.isInteger(vmid) || vmid < 1) throw new ValidationError("Invalid VMID");
    assertGuestAccess(session.user, params.id, kind, vmid);
    const ticketId = new URL(req.url).searchParams.get("ticket")?.trim() ?? "";
    if (!ticketId || ticketId.length > 80) throw new NotFoundError("Transfer abgelaufen oder ungültig");
    const ticket = takeGuestTransferTicket(ticketId, session.user.id, "upload");
    if (ticket.hostId !== params.id || ticket.kind !== kind || ticket.node !== params.node || ticket.vmid !== vmid) {
      throw new NotFoundError("Transfer abgelaufen oder ungültig");
    }
    const host = await getHostOrThrow(params.id, session.user);
    const ip = await clientIp();
    try {
      const result = await streamGuestFileUpload(host, {
        kind: ticket.kind,
        vmid: ticket.vmid,
        target: ticket.target,
        port: ticket.port,
        username: ticket.username,
        password: ticket.password,
        path: ticket.path,
        body: req.body,
        contentLength: req.headers.get("content-length"),
      });
      await writeAuditLog({
        userId: session.user.id,
        ip,
        action: AUDIT_ACTIONS.GUEST_FILES_WRITE,
        target: `${kind.toUpperCase()} ${vmid} ${ticket.path}`,
        hostId: params.id,
        result: "SUCCESS",
        metadata: { ...auditMeta(ticket), size: result.size },
      });
      return json({ ...result, via: "sftp" as const });
    } catch (error) {
      await writeAuditLog({
        userId: session.user.id,
        ip,
        action: AUDIT_ACTIONS.GUEST_FILES_WRITE,
        target: `${kind.toUpperCase()} ${vmid} ${ticket.path}`,
        hostId: params.id,
        result: "FAILURE",
        error: error instanceof Error ? error.message : String(error),
        metadata: auditMeta(ticket),
      });
      throw error;
    }
  });
}
