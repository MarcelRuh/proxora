import { NextResponse } from "next/server";
import { apiRoute } from "@/server/http/api-route";
import { ValidationError } from "@/lib/errors";
import { assertGuestAccess } from "@/server/auth/session-core";
import { withHostClient } from "@/server/services/host-service";
import { hostNameFromUrl, spiceViewerFile, type SpiceProxyResult } from "@/lib/spice-vv";

export const GET = apiRoute("vm.console", async (_req, session, params) => {
  const vmid = Number(params.vmid);
  if (!Number.isInteger(vmid)) throw new ValidationError("Invalid VMID");
  assertGuestAccess(session.user, params.id, "vm", vmid);
  const file = await withHostClient(params.id, session.user, async (client, host) => {
    const proxy = (await client.vms.spiceproxy(params.node, vmid)) as SpiceProxyResult;
    return spiceViewerFile(proxy, hostNameFromUrl(host.url));
  });
  return new NextResponse(file, {
    status: 200,
    headers: {
      "Content-Type": "application/x-virt-viewer",
      "Content-Disposition": `attachment; filename="proxora-${vmid}.vv"`,
    },
  });
});
