import { guestFirewallRoutes } from "@/server/http/guest-firewall-route";

const routes = guestFirewallRoutes("lxc");
export const GET = routes.GET;
export const PUT = routes.PUT;
export const POST = routes.POST;
export const DELETE = routes.DELETE;
