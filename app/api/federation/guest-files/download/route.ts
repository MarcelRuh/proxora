import { z } from "zod";
import { ValidationError } from "@/lib/errors";
import { handleRouteError } from "@/server/http/respond";
import { requireSharedGuestFiles } from "@/server/services/federation-service";
import { sftpDownloadResponse } from "@/server/services/guest-files";
import { GUEST_SSH_KEY_MAX, hasGuestSshAuth } from "@/lib/guest-files";

const bodySchema = z
  .object({
    remoteHostId: z.string().min(1),
    kind: z.enum(["vm", "lxc"]),
    vmid: z.number().int().positive(),
    target: z.string().min(1).max(253),
    port: z.number().int().min(1).max(65535).optional(),
    username: z.string().min(1).max(64),
    password: z.string().max(512).optional(),
    privateKey: z.string().max(GUEST_SSH_KEY_MAX).optional(),
    passphrase: z.string().max(512).optional(),
    path: z.string().min(1).max(4096),
  })
  .superRefine((data, ctx) => {
    if (!hasGuestSshAuth(data)) {
      ctx.addIssue({ code: "custom", message: "SSH-Passwort oder Schlüssel fehlt", path: ["password"] });
    }
  });

export const dynamic = "force-dynamic";
export const maxDuration = 3600;

export async function POST(request: Request) {
  try {
    const payload = bodySchema.parse(await request.json());
    await requireSharedGuestFiles(request, payload.remoteHostId, payload.kind);
    if (!payload.target.trim()) throw new ValidationError("SSH host fehlt");
    return await sftpDownloadResponse({
      target: payload.target,
      port: payload.port,
      username: payload.username,
      password: payload.password,
      privateKey: payload.privateKey,
      passphrase: payload.passphrase,
      path: payload.path,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
