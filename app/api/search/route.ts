import { z } from "zod";
import { apiRoute } from "@/server/http/api-route";
import { json } from "@/server/http/respond";
import { globalSearch } from "@/server/services/search-service";

export const GET = apiRoute(null, async (req, session) => {
  const q = new URL(req.url).searchParams.get("q") ?? "";
  z.string().max(80).parse(q);
  return json(await globalSearch(session.user, q));
});
