"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { SessionUser } from "@/lib/types";
import { hasAnyPermission, hasPermission, type Permission } from "@/lib/permissions";

const SessionUserContext = createContext<SessionUser | null>(null);

export function SessionUserProvider({ user, children }: { user: SessionUser; children: ReactNode }) {
  return <SessionUserContext.Provider value={user}>{children}</SessionUserContext.Provider>;
}

export function useSessionUser(): SessionUser {
  const user = useContext(SessionUserContext);
  if (!user) throw new Error("SessionUserProvider missing");
  return user;
}

export function useCan(permission: Permission): boolean {
  const user = useContext(SessionUserContext);
  return hasPermission(user?.role.permissions, permission);
}

export function useCanAny(permissions: Permission[]): boolean {
  const user = useContext(SessionUserContext);
  return hasAnyPermission(user?.role.permissions, permissions);
}
