import { z } from "zod";
import { apiRoute } from "@/server/http/api-route";
import { json } from "@/server/http/respond";
import { ValidationError } from "@/lib/errors";
import { assertGuestAccess } from "@/server/auth/session-core";
import { withHostClient } from "@/server/services/host-service";
import { loadGuestHa, saveGuestHa } from "@/server/services/cluster-service";

const patchSchema = z.object({
  enabled: z.boolean(),
  group: z.string().optional(),
  state: z.enum(["started", "stopped", "ignored", "disabled"]).optional(),
  maxRestart: z.number().int().min(0).max(10).optional(),
  maxRelocate: z.number().int().min(0).max(10).optional(),
});

export function guestHaRoutes(kind: "vm" | "lxc") {
  const view = kind === "vm" ? "vm.view" : "lxc.view";
  const config = kind === "vm" ? "vm.config" : "lxc.config";
  return {
    GET: apiRoute(view, async (_req, session, params) => {
      const vmid = Number(params.vmid);
      if (!Number.isInteger(vmid)) throw new ValidationError("Invalid VMID");
      assertGuestAccess(session.user, params.id, kind, vmid);
      const data = await withHostClient(params.id, session.user, async (client, host) => {
        return loadGuestHa(client, host, kind, vmid);
      });
      return json(data);
    }),
    PUT: apiRoute(config, async (req, session, params) => {
      const vmid = Number(params.vmid);
      if (!Number.isInteger(vmid)) throw new ValidationError("Invalid VMID");
      assertGuestAccess(session.user, params.id, kind, vmid);
      const body = patchSchema.parse(await req.json());
      const data = await withHostClient(params.id, session.user, async (client, host) => {
        return saveGuestHa(client, host, kind, vmid, body);
      });
      return json(data);
    }),
  };
}
