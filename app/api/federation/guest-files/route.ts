import { z } from "zod";
import { HostOrigin } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { handleRouteError, json } from "@/server/http/respond";
import { requireFederationPeer } from "@/server/services/federation-service";
import { parseShareLevel, shareHasPermission } from "@/lib/federation-access";
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
    const peer = await requireFederationPeer(request);
    const payload = bodySchema.parse(await request.json());
    const share = await prisma.hostShare.findUnique({
      where: { peerId_hostId: { peerId: peer.id, hostId: payload.remoteHostId } },
      include: { host: true },
    });
    if (!share || share.host.origin !== HostOrigin.LOCAL) throw new NotFoundError("Host not shared");
    const level = parseShareLevel(String(share.level)) ?? "view";
    const needed = payload.kind === "vm" ? "vm.files" : "lxc.files";
    if (!shareHasPermission(level, share.permissions, needed)) {
      throw new ForbiddenError("This host is not shared at that level");
    }
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
