import { guestHaRoutes } from "@/server/http/guest-ha-route";

const routes = guestHaRoutes("vm");
export const GET = routes.GET;
export const PUT = routes.PUT;
