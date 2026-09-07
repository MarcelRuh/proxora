import { guestHaRoutes } from "@/server/http/guest-ha-route";

const routes = guestHaRoutes("lxc");
export const GET = routes.GET;
export const PUT = routes.PUT;
