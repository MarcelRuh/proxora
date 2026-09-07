import { z } from "zod";
import { apiRoute } from "@/server/http/api-route";
import { json } from "@/server/http/respond";
import { ValidationError } from "@/lib/errors";
import { assertGuestAccess } from "@/server/auth/session-core";
import { withHostClient } from "@/server/services/host-service";

const optionsSchema = z.object({
  enable: z.number().int().min(0).max(1).optional(),
  dhcp: z.number().int().min(0).max(1).optional(),
  ipfilter: z.number().int().min(0).max(1).optional(),
  policy_in: z.string().optional(),
  policy_out: z.string().optional(),
  log_level_in: z.string().optional(),
  log_level_out: z.string().optional(),
});

const ruleSchema = z.object({
  type: z.enum(["in", "out", "group"]).default("in"),
  action: z.enum(["ACCEPT", "DROP", "REJECT"]).default("ACCEPT"),
  enable: z.number().int().min(0).max(1).optional(),
  proto: z.string().optional(),
  source: z.string().optional(),
  dest: z.string().optional(),
  dport: z.string().optional(),
  sport: z.string().optional(),
  comment: z.string().optional(),
});

export function guestFirewallRoutes(kind: "vm" | "lxc") {
  const view = kind === "vm" ? "vm.view" : "lxc.view";
  const config = kind === "vm" ? "vm.config" : "lxc.config";
  return {
    GET: apiRoute(view, async (_req, session, params) => {
      const vmid = Number(params.vmid);
      if (!Number.isInteger(vmid)) throw new ValidationError("Invalid VMID");
      assertGuestAccess(session.user, params.id, kind, vmid);
      const data = await withHostClient(params.id, session.user, async (client) => {
        const [options, rules] = await Promise.all([
          client.firewall.options(kind, params.node, vmid),
          client.firewall.rules(kind, params.node, vmid).catch(() => []),
        ]);
        return { options, rules: Array.isArray(rules) ? rules : [] };
      });
      return json(data);
    }),
    PUT: apiRoute(config, async (req, session, params) => {
      const vmid = Number(params.vmid);
      if (!Number.isInteger(vmid)) throw new ValidationError("Invalid VMID");
      assertGuestAccess(session.user, params.id, kind, vmid);
      const body = optionsSchema.parse(await req.json());
      await withHostClient(params.id, session.user, async (client) => {
        await client.firewall.setOptions(kind, params.node, vmid, body);
      });
      return json({ ok: true });
    }),
    POST: apiRoute(config, async (req, session, params) => {
      const vmid = Number(params.vmid);
      if (!Number.isInteger(vmid)) throw new ValidationError("Invalid VMID");
      assertGuestAccess(session.user, params.id, kind, vmid);
      const body = ruleSchema.parse(await req.json());
      await withHostClient(params.id, session.user, async (client) => {
        await client.firewall.createRule(kind, params.node, vmid, body);
      });
      return json({ ok: true }, 201);
    }),
    DELETE: apiRoute(config, async (req, session, params) => {
      const vmid = Number(params.vmid);
      if (!Number.isInteger(vmid)) throw new ValidationError("Invalid VMID");
      assertGuestAccess(session.user, params.id, kind, vmid);
      const pos = Number(new URL(req.url).searchParams.get("pos"));
      if (!Number.isInteger(pos) || pos < 0) throw new ValidationError("Rule position missing");
      await withHostClient(params.id, session.user, async (client) => {
        await client.firewall.deleteRule(kind, params.node, vmid, pos);
      });
      return json({ ok: true });
    }),
  };
}
