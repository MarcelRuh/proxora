import { z } from "zod";
import { apiRoute } from "@/server/http/api-route";
import { json } from "@/server/http/respond";
import { clientIp } from "@/server/auth/session";
import { writeAuditLog } from "@/server/services/audit-service";
import { AUDIT_ACTIONS } from "@/lib/audit-actions";
import { ValidationError } from "@/lib/errors";
import { assertGuestAccess } from "@/server/auth/session-core";
import { withHostClient } from "@/server/services/host-service";
import { readLxcSshRoot, setLxcSshRoot } from "@/server/services/lxc-ssh-root";

export const maxDuration = 60;

const bodySchema = z.object({
  enabled: z.boolean(),
});

export const GET = apiRoute("lxc.view", async (_req, session, params) => {
  const vmid = Number(params.vmid);
  if (!Number.isInteger(vmid) || vmid < 1) throw new ValidationError("Invalid VMID");
  assertGuestAccess(session.user, params.id, "lxc", vmid);
  const data = await withHostClient(params.id, session.user, async (client, host) => {
    return readLxcSshRoot(client, host, params.node, vmid);
  });
  return json(data);
});

export const POST = apiRoute(["lxc.files.write", "lxc.config"], async (req, session, params) => {
  const vmid = Number(params.vmid);
  if (!Number.isInteger(vmid) || vmid < 1) throw new ValidationError("Invalid VMID");
  assertGuestAccess(session.user, params.id, "lxc", vmid);
  const body = bodySchema.parse(await req.json());
  const data = await withHostClient(params.id, session.user, async (client, host) => {
    return setLxcSshRoot(client, host, params.node, vmid, body.enabled);
  });
  await writeAuditLog({
    userId: session.user.id,
    ip: await clientIp(),
    action: body.enabled ? AUDIT_ACTIONS.LXC_SSH_ROOT_ENABLED : AUDIT_ACTIONS.LXC_SSH_ROOT_DISABLED,
    target: `LXC ${vmid}`,
    hostId: params.id,
    result: "SUCCESS",
  });
  return json(data);
});
