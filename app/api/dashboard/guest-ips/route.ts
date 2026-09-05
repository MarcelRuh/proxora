import { z } from "zod";
import { apiRoute } from "@/server/http/api-route";
import { json } from "@/server/http/respond";
import { hydrateVisibleGuestIps } from "@/server/services/dashboard-service";

const schema = z.object({
  guests: z
    .array(
      z.object({
        hostId: z.string().min(1),
        node: z.string().min(1),
        vmid: z.number().int().positive(),
        kind: z.enum(["vm", "lxc"]),
      }),
    )
    .max(40),
});

export const POST = apiRoute("hosts.view", async (req, session) => {
  const body = schema.parse(await req.json());
  return json(await hydrateVisibleGuestIps(session.user, body.guests));
});
