import { apiRoute } from "@/server/http/api-route";
import { json } from "@/server/http/respond";
import { getVapidKeys } from "@/server/services/push-service";

export const GET = apiRoute(["hosts.view", "notifications.view"], async () => {
  const keys = await getVapidKeys();
  return json({ publicKey: keys.publicKey });
});
