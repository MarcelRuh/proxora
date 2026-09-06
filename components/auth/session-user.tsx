"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { SessionUser } from "@/lib/types";
import { userHasAnyPermission, userHasPermission, type Permission } from "@/lib/permissions";

const SessionUserContext = createContext<SessionUser | null>(null);

export function SessionUserProvider({ user, children }: { user: SessionUser; children: ReactNode }) {
  return <SessionUserContext.Provider value={user}>{children}</SessionUserContext.Provider>;
}

export function useSessionUser(): SessionUser {
  const user = useContext(SessionUserContext);
  if (!user) throw new Error("SessionUserProvider missing");
  return user;
}

export function useCan(
  permission: Permission,
  hostId?: string | null,
  guest?: { hostId: string; kind: "vm" | "lxc"; vmid: number } | null,
): boolean {
  const user = useContext(SessionUserContext);
  return userHasPermission(user, permission, hostId, guest);
}

export function useCanAny(
  permissions: Permission[],
  hostId?: string | null,
  guest?: { hostId: string; kind: "vm" | "lxc"; vmid: number } | null,
): boolean {
  const user = useContext(SessionUserContext);
  return userHasAnyPermission(user, permissions, hostId, guest);
}
