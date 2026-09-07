import { NextResponse } from "next/server";
import { apiRoute } from "@/server/http/api-route";
import { clientIp } from "@/server/auth/session";
import { writeAuditLog } from "@/server/services/audit-service";
import { AUDIT_ACTIONS } from "@/lib/audit-actions";
import { dumpProxoraPostgres } from "@/server/services/proxora-backup";

export const GET = apiRoute("proxora.update", async (_req, session) => {
  const dump = await dumpProxoraPostgres();
  await writeAuditLog({
    userId: session.user.id,
    ip: await clientIp(),
    action: AUDIT_ACTIONS.PROXORA_BACKUP,
    target: session.user.username,
    result: "SUCCESS",
  });
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  return new NextResponse(new Uint8Array(dump), {
    status: 200,
    headers: {
      "Content-Type": "application/sql; charset=utf-8",
      "Content-Disposition": `attachment; filename="proxora-${stamp}.sql"`,
    },
  });
});
