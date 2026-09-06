import { z } from "zod";
import { ValidationError } from "@/lib/errors";
import { handleRouteError, json } from "@/server/http/respond";
import { requireSharedGuestFiles } from "@/server/services/federation-service";
import { sftpUploadFromStream } from "@/server/services/guest-files";
import { decodeGuestTransferMeta, GUEST_TRANSFER_META_HEADER } from "@/server/services/guest-file-tickets";

const metaSchema = z.object({
  remoteHostId: z.string().min(1),
  kind: z.enum(["vm", "lxc"]),
  vmid: z.number().int().positive(),
  target: z.string().min(1).max(253),
  port: z.number().int().min(1).max(65535).optional(),
  username: z.string().min(1).max(64),
  password: z.string().min(1).max(512),
  path: z.string().min(1).max(4096),
});

export const dynamic = "force-dynamic";
export const maxDuration = 3600;

export async function POST(request: Request) {
  try {
    const raw = request.headers.get(GUEST_TRANSFER_META_HEADER) ?? "";
    let parsed: unknown;
    try {
      parsed = decodeGuestTransferMeta(raw);
    } catch {
      throw new ValidationError("Upload-Meta fehlt");
    }
    const payload = metaSchema.parse(parsed);
    await requireSharedGuestFiles(request, payload.remoteHostId, payload.kind);
    if (!payload.target.trim()) throw new ValidationError("SSH host fehlt");
    const result = await sftpUploadFromStream({
      target: payload.target,
      port: payload.port,
      username: payload.username,
      password: payload.password,
      path: payload.path,
      body: request.body,
    });
    return json({ ...result, via: "sftp" });
  } catch (error) {
    return handleRouteError(error);
  }
}
