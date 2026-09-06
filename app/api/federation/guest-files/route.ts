import { z } from "zod";
import { ValidationError } from "@/lib/errors";
import { handleRouteError, json } from "@/server/http/respond";
import { requireSharedGuestFiles } from "@/server/services/federation-service";
import { guestSftp } from "@/server/services/guest-files";
import { GUEST_FILE_MAX_BYTES } from "@/lib/guest-files";

const bodySchema = z.object({
  remoteHostId: z.string().min(1),
  kind: z.enum(["vm", "lxc"]),
  vmid: z.number().int().positive(),
  op: z.enum(["list", "read", "write", "mkdir", "delete"]),
  target: z.string().min(1).max(253),
  port: z.number().int().min(1).max(65535).optional(),
  username: z.string().min(1).max(64),
  password: z.string().min(1).max(512),
  path: z.string().min(1).max(4096),
  contentBase64: z.string().max(Math.ceil(GUEST_FILE_MAX_BYTES * 1.4) + 32).optional(),
});

export async function POST(request: Request) {
  try {
    const payload = bodySchema.parse(await request.json());
    await requireSharedGuestFiles(request, payload.remoteHostId, payload.kind);
    if (!payload.target.trim()) throw new ValidationError("SSH host fehlt");
    const data = await guestSftp({
      kind: payload.kind,
      node: "",
      vmid: payload.vmid,
      op: payload.op,
      target: payload.target,
      port: payload.port,
      username: payload.username,
      password: payload.password,
      path: payload.path,
      contentBase64: payload.contentBase64,
    });
    return json(data);
  } catch (error) {
    return handleRouteError(error);
  }
}
