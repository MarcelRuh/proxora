import { z } from "zod";
import { apiRoute } from "@/server/http/api-route";
import { json } from "@/server/http/respond";
import { clientIp } from "@/server/auth/session";
import { writeAuditLog } from "@/server/services/audit-service";
import { AUDIT_ACTIONS } from "@/lib/audit-actions";
import { prisma } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/password";
import { ValidationError } from "@/lib/errors";

const schema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(10).max(200),
});

export const POST = apiRoute(null, async (req, session) => {
  const body = schema.parse(await req.json());
  const user = await prisma.user.findUnique({ where: { id: session.user.id } });
  if (!user || !(await verifyPassword(body.currentPassword, user.passwordHash))) {
    throw new ValidationError("CURRENT_PASSWORD_INVALID");
  }
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: await hashPassword(body.newPassword) },
  });
  await writeAuditLog({
    userId: session.user.id,
    ip: await clientIp(),
    action: AUDIT_ACTIONS.USER_UPDATED,
    target: session.user.username,
    result: "SUCCESS",
    metadata: { password: true },
  });
  return json({ ok: true });
});
