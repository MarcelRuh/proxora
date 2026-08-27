import { z } from "zod";
import { apiRoute } from "@/server/http/api-route";
import { json } from "@/server/http/respond";
import { clientIp } from "@/server/auth/session";
import { writeAuditLog } from "@/server/services/audit-service";
import { AUDIT_ACTIONS } from "@/lib/audit-actions";
import {
  listHostUpdates,
  refreshHostUpdates,
  upgradeConsoleTarget,
} from "@/server/services/update-service";

const bodySchema = z.object({
  action: z.enum(["check", "upgrade"]),
  node: z.string().optional(),
  confirm: z.boolean().optional(),
});

export const GET = apiRoute("updates.view", async (_req, session, params) => {
  const data = await listHostUpdates(params.id, session.user);
  return json(data);
});

export const POST = apiRoute("updates.execute", async (req, session, params) => {
  const body = bodySchema.parse(await req.json());
  if (body.action === "check") {
    const data = await refreshHostUpdates(params.id, session.user, body.node);
    return json(data);
  }
  if (body.confirm !== true) {
    const { ValidationError } = await import("@/lib/errors");
    throw new ValidationError("Bestätigung für Host-Updates erforderlich");
  }
  const target = await upgradeConsoleTarget(params.id, session.user, body.node);
  await writeAuditLog({
    userId: session.user.id,
    ip: await clientIp(),
    action: AUDIT_ACTIONS.UPDATE_STARTED,
    target: params.id,
    hostId: params.id,
    result: "SUCCESS",
    metadata: { mode: "console", node: target.node },
  });
  return json(target);
});
