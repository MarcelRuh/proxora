import { z } from "zod";
import { apiRoute } from "@/server/http/api-route";
import { json } from "@/server/http/respond";
import { clientIp } from "@/server/auth/session";
import { writeAuditLog } from "@/server/services/audit-service";
import { AUDIT_ACTIONS } from "@/lib/audit-actions";
import { ValidationError } from "@/lib/errors";
import { assertGuestAccess } from "@/server/auth/session-core";
import { getHostOrThrow } from "@/server/services/host-service";
import { runGuestFileOp, type GuestFileOp } from "@/server/services/guest-files";
import { createGuestTransferTicket } from "@/server/services/guest-file-tickets";
import { GUEST_FILE_MAX_BYTES, GUEST_SSH_KEY_MAX, hasGuestSshAuth } from "@/lib/guest-files";

const bodySchema = z
  .object({
    op: z.enum(["list", "read", "write", "mkdir", "delete", "rename", "transfer-ticket"]),
    mode: z.enum(["download", "upload"]).optional(),
    via: z.enum(["agent", "sftp"]).optional(),
    target: z.string().min(1).max(253).optional(),
    port: z.number().int().min(1).max(65535).optional(),
    username: z.string().min(1).max(64).optional(),
    password: z.string().max(512).optional(),
    privateKey: z.string().max(GUEST_SSH_KEY_MAX).optional(),
    passphrase: z.string().max(512).optional(),
    path: z.string().min(1).max(4096),
    to: z.string().min(1).max(4096).optional(),
    contentBase64: z.string().max(Math.ceil(GUEST_FILE_MAX_BYTES * 1.4) + 32).optional(),
  })
  .superRefine((data, ctx) => {
    const via = data.via ?? (hasGuestSshAuth(data) ? "sftp" : "agent");
    if (via === "sftp" && (!data.target || !data.username || !hasGuestSshAuth(data))) {
      ctx.addIssue({ code: "custom", message: "SSH-Zugangsdaten fehlen" });
    }
    if (data.op === "rename" && !data.to) {
      ctx.addIssue({ code: "custom", message: "Neuer Name fehlt", path: ["to"] });
    }
  });

const AUDIT: Record<GuestFileOp, string> = {
  list: AUDIT_ACTIONS.GUEST_FILES_LIST,
  read: AUDIT_ACTIONS.GUEST_FILES_READ,
  write: AUDIT_ACTIONS.GUEST_FILES_WRITE,
  mkdir: AUDIT_ACTIONS.GUEST_FILES_MKDIR,
  delete: AUDIT_ACTIONS.GUEST_FILES_DELETE,
  rename: AUDIT_ACTIONS.GUEST_FILES_RENAME,
};

export function guestFilesRoute(kind: "vm" | "lxc") {
  const permission = kind === "vm" ? "vm.files" : "lxc.files";
  return apiRoute(permission, async (req, session, params) => {
    const vmid = Number(params.vmid);
    if (!Number.isInteger(vmid) || vmid < 1) throw new ValidationError("Invalid VMID");
    assertGuestAccess(session.user, params.id, kind, vmid);
    const body = bodySchema.parse(await req.json());
    const via = body.via ?? (kind === "vm" && !hasGuestSshAuth(body) ? "agent" : "sftp");
    if (via === "agent" && kind !== "vm") {
      throw new ValidationError("Der QEMU Agent gibt es nur bei VMs. LXC braucht SSH im Container.");
    }
    if ((body.op === "write" || body.op === "mkdir" || body.op === "rename") && !body.path) {
      throw new ValidationError("Path fehlt");
    }
    const host = await getHostOrThrow(params.id, session.user);
    if (body.op === "transfer-ticket") {
      if (via !== "sftp") {
        throw new ValidationError("Stream-Transfer nur per SFTP");
      }
      const mode = body.mode;
      if (mode !== "download" && mode !== "upload") {
        throw new ValidationError("Transfer-Modus fehlt");
      }
      const issued = createGuestTransferTicket({
        userId: session.user.id,
        hostId: host.id,
        kind,
        node: params.node,
        vmid,
        path: body.path,
        target: body.target ?? "",
        port: body.port,
        username: body.username ?? "",
        password: body.password ?? "",
        privateKey: body.privateKey,
        passphrase: body.passphrase,
        mode,
      });
      return json({
        ticket: issued.ticket,
        path: issued.path,
        name: issued.name,
        mode: issued.mode,
        via: "sftp" as const,
      });
    }
    const result = await runGuestFileOp(host, {
      kind,
      node: params.node,
      vmid,
      op: body.op,
      via,
      target: body.target,
      port: body.port,
      username: body.username,
      password: body.password,
      privateKey: body.privateKey,
      passphrase: body.passphrase,
      path: body.path,
      to: body.to,
      contentBase64: body.contentBase64,
    });
    await writeAuditLog({
      userId: session.user.id,
      ip: await clientIp(),
      action: AUDIT[body.op],
      target: `${kind.toUpperCase()} ${vmid} ${body.path}`,
      hostId: params.id,
      result: "SUCCESS",
      metadata: {
        op: body.op,
        path: body.path,
        to: body.to ?? null,
        via,
        sshHost: body.target ?? null,
        sshUser: body.username ?? null,
      },
    });
    return json(result);
  });
}
