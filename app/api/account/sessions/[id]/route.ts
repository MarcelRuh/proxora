import { prisma } from "@/lib/db";
import { apiRoute } from "@/server/http/api-route";
import { json } from "@/server/http/respond";
import { clientIp } from "@/server/auth/session";
import { writeAuditLog } from "@/server/services/audit-service";
import { AUDIT_ACTIONS } from "@/lib/audit-actions";
import { NotFoundError, ValidationError } from "@/lib/errors";

export const DELETE = apiRoute(null, async (_req, session, params) => {
  if (params.id === session.id) {
    throw new ValidationError("Die aktuelle Sitzung kann hier nicht beendet werden");
  }
  const existing = await prisma.session.findFirst({
    where: { id: params.id, userId: session.user.id },
  });
  if (!existing) throw new NotFoundError("Session not found");
  await prisma.session.delete({ where: { id: existing.id } });
  await writeAuditLog({
    userId: session.user.id,
    ip: await clientIp(),
    action: AUDIT_ACTIONS.SESSION_REVOKED,
    target: existing.ip ?? existing.id,
    result: "SUCCESS",
  });
  return json({ ok: true });
});
