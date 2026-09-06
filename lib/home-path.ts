import { userHasAnyPermission, userHasPermission, type Permission } from "@/lib/permissions";
import type { GuestScope } from "@/lib/guest-scope";

export type HomePathUser = {
  role?: { permissions?: readonly string[] };
  hostPermissions?: Record<string, string[] | null> | null;
  allowedGuests?: GuestScope[] | null;
};

export function homePathForUser(user: HomePathUser): string {
  if (userHasPermission(user, "hosts.view")) return "/dashboard";
  const guests = user.allowedGuests ?? [];
  if (guests.some((g) => g.kind === "lxc") && userHasPermission(user, "lxc.view")) return "/containers";
  if (guests.some((g) => g.kind === "vm") && userHasPermission(user, "vm.view")) return "/vms";
  if (userHasPermission(user, "lxc.view")) return "/containers";
  if (userHasPermission(user, "vm.view")) return "/vms";
  return "/dashboard";
}

export function resolvePostLoginPath(user: HomePathUser, next: string): string {
  if (next === "/" || next === "/dashboard") return homePathForUser(user);
  if ((next === "/hosts" || next.startsWith("/hosts/")) && !userHasPermission(user, "hosts.view")) {
    return homePathForUser(user);
  }
  return next;
}

export function navItemVisible(
  user: HomePathUser,
  href: string,
  anyOf: readonly Permission[],
): boolean {
  if (!userHasAnyPermission(user, anyOf)) return false;
  if ((href === "/vms" || href === "/containers") && !userHasPermission(user, "hosts.view")) {
    const guests = user.allowedGuests ?? [];
    if (!guests.length) return href === homePathForUser(user);
    if (href === "/vms") return guests.some((g) => g.kind === "vm");
    return guests.some((g) => g.kind === "lxc");
  }
  return true;
}
