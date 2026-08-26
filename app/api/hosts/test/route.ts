import { apiRoute } from "@/server/http/api-route";
import { json } from "@/server/http/respond";
import { testRawConnection, hostInputSchema } from "@/server/services/host-service";

export const POST = apiRoute("hosts.create", async (req) => {
  const body = hostInputSchema.parse(await req.json());
  const result = await testRawConnection(body);
  return json(result, result.ok ? 200 : 400);
});
