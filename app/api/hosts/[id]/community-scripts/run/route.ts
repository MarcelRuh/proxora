import { z } from "zod";
import { apiRoute } from "@/server/http/api-route";
import { json } from "@/server/http/respond";
import { clientIp } from "@/server/auth/session";
import { writeAuditLog } from "@/server/services/audit-service";
import { AUDIT_ACTIONS } from "@/lib/audit-actions";
import { ValidationError } from "@/lib/errors";
import { isSafeCommunityScriptSlug } from "@/lib/community-scripts";
import { pickHostConsoleNode } from "@/lib/host-console";
import { assertCommunityScriptInstallable } from "@/server/services/community-scripts";
import { withHostClient } from "@/server/services/host-service";
import { inventoryNodeNames, loadHostInventory } from "@/server/services/inventory-cache";

const bodySchema = z.object({
  slug: z.string().min(1).max(80),
  node: z.string().min(1).optional(),
  confirm: z.literal(true),
});

export const POST = apiRoute("hosts.console", async (req, session, params) => {
  const body = bodySchema.parse(await req.json());
  if (!isSafeCommunityScriptSlug(body.slug)) {
    throw new ValidationError("Ungültiger Script-Slug");
  }
  const install = await assertCommunityScriptInstallable(body.slug);
  const node = await withHostClient(params.id, session.user, async (client) => {
    const names = inventoryNodeNames(await loadHostInventory(client, params.id));
    const picked = pickHostConsoleNode(
      names.map((name) => ({ node: name, online: "online" })),
      body.node,
    );
    if (!picked) throw new ValidationError("Kein Node verfügbar");
    return picked;
  });

  await writeAuditLog({
    userId: session.user.id,
    ip: await clientIp(),
    action: AUDIT_ACTIONS.COMMUNITY_SCRIPT_STARTED,
    target: install.script.slug,
    hostId: params.id,
    result: "SUCCESS",
    metadata: {
      mode: "console",
      node,
      slug: install.script.slug,
      name: install.script.name,
      kind: install.script.kind,
      sourceUrl: install.sourceUrl,
    },
  });

  return json({
    mode: "console" as const,
    node,
    command: install.command,
    sourceUrl: install.sourceUrl,
    pageUrl: install.pageUrl,
    script: install.script,
  });
});
