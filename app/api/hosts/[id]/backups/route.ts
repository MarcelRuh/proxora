import { z } from "zod";
import { apiRoute } from "@/server/http/api-route";
import { json } from "@/server/http/respond";
import { clientIp } from "@/server/auth/session";
import { writeAuditLog } from "@/server/services/audit-service";
import { AUDIT_ACTIONS } from "@/lib/audit-actions";
import { withHostClient } from "@/server/services/host-service";
import { compactProxmoxBody } from "@/lib/lxc-net";
import { newBackupJobId, parseBackupVolid } from "@/lib/backup";
import { jobBody, listHostBackups, restoreBackup, runBackupJob } from "@/server/services/backup-service";
import { ValidationError } from "@/lib/errors";

const jobFields = {
  enabled: z.boolean().optional(),
  schedule: z.string().min(1),
  storage: z.string().min(1),
  mode: z.enum(["snapshot", "suspend", "stop"]).optional(),
  compress: z.string().optional(),
  all: z.boolean().optional(),
  vmid: z.string().optional(),
  node: z.string().optional(),
  keepLast: z.number().int().min(0).nullable().optional(),
};

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create-job"), id: z.string().optional(), ...jobFields }),
  z.object({ action: z.literal("update-job"), id: z.string().min(1), ...jobFields }),
  z.object({ action: z.literal("delete-job"), id: z.string().min(1) }),
  z.object({ action: z.literal("run-job"), id: z.string().min(1), node: z.string().optional() }),
  z.object({
    action: z.literal("run"),
    node: z.string().min(1),
    vmid: z.string().min(1),
    storage: z.string().min(1),
    mode: z.enum(["snapshot", "suspend", "stop"]).optional(),
    compress: z.string().optional(),
  }),
  z.object({
    action: z.literal("restore"),
    node: z.string().min(1),
    volid: z.string().min(1),
    vmid: z.number().int().positive(),
    storage: z.string().min(1),
    force: z.boolean().optional(),
    startAfter: z.boolean().optional(),
  }),
  z.object({
    action: z.literal("delete-file"),
    node: z.string().min(1),
    volid: z.string().min(1),
  }),
]);

export const GET = apiRoute(["backup.view", "storage.view"], async (_req, session, params) => {
  return json(await listHostBackups(params.id, session.user));
});

export const POST = apiRoute(["backup.manage", "storage.manage"], async (req, session, params) => {
  const body = schema.parse(await req.json());
  const result = await withHostClient(params.id, session.user, async (client) => {
    switch (body.action) {
      case "create-job": {
        const id = body.id?.trim() || newBackupJobId();
        await client.backup.createJob(jobBody({ ...body, id }));
        return { id };
      }
      case "update-job":
        await client.backup.updateJob(body.id, jobBody({ ...body, id: undefined }));
        return { id: body.id };
      case "delete-job":
        await client.backup.deleteJob(body.id);
        return { id: body.id };
      case "run-job": {
        const upid = await runBackupJob(client, body.id, body.node);
        return { upid };
      }
      case "run": {
        const upid = await client.backup.start(
          body.node,
          compactProxmoxBody({
            vmid: body.vmid.replace(/\s+/g, ""),
            storage: body.storage,
            mode: body.mode ?? "snapshot",
            compress: body.compress ?? "zstd",
          }),
        );
        return { upid };
      }
      case "restore": {
        const upid = await restoreBackup(client, body);
        return { upid };
      }
      case "delete-file": {
        const parsed = parseBackupVolid(body.volid);
        if (!parsed.storage || !parsed.volume) throw new ValidationError("Ungültiges Backup-Volume");
        await client.storage.deleteContent(body.node, parsed.storage, parsed.volume);
        return { volid: body.volid };
      }
      default:
        throw new ValidationError("Unbekannte Aktion");
    }
  });

  const audit =
    body.action === "create-job"
      ? AUDIT_ACTIONS.BACKUP_JOB_CREATED
      : body.action === "update-job"
        ? AUDIT_ACTIONS.BACKUP_JOB_UPDATED
        : body.action === "delete-job"
          ? AUDIT_ACTIONS.BACKUP_JOB_DELETED
          : body.action === "restore"
            ? AUDIT_ACTIONS.BACKUP_RESTORED
            : body.action === "delete-file"
              ? AUDIT_ACTIONS.BACKUP_FILE_DELETED
              : AUDIT_ACTIONS.BACKUP_STARTED;

  await writeAuditLog({
    userId: session.user.id,
    ip: await clientIp(),
    action: audit,
    target:
      "id" in body
        ? String(body.id ?? ("volid" in body ? body.volid : ""))
        : "volid" in body
          ? body.volid
          : "vmid" in body
            ? String(body.vmid)
            : params.id,
    hostId: params.id,
    result: "SUCCESS",
    metadata: { action: body.action, ...result },
  });
  return json(result);
});
