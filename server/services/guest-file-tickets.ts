import { randomBytes } from "node:crypto";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { clampSftpPort, guestFileName, isAllowedSftpTarget, resolveGuestPath } from "@/lib/guest-files";

export const GUEST_DOWNLOAD_TICKET_TTL_MS = 120_000;

export type GuestDownloadTicket = {
  id: string;
  userId: string;
  hostId: string;
  kind: "vm" | "lxc";
  node: string;
  vmid: number;
  path: string;
  target: string;
  port: number;
  username: string;
  password: string;
  expiresAt: number;
};

const tickets = new Map<string, GuestDownloadTicket>();

function pruneTickets(now = Date.now()) {
  for (const [id, row] of tickets) {
    if (row.expiresAt <= now) tickets.delete(id);
  }
}

export function createGuestDownloadTicket(
  input: Omit<GuestDownloadTicket, "id" | "expiresAt" | "path" | "target" | "port"> & {
    path: string;
    target: string;
    port?: number;
    expiresAt?: number;
  },
): { ticket: string; path: string; name: string } {
  pruneTickets();
  let path: string;
  let target: string;
  let port: number;
  try {
    path = resolveGuestPath(input.path);
    target = isAllowedSftpTarget(input.target);
    port = clampSftpPort(input.port ?? 22);
  } catch (error) {
    throw new ValidationError(error instanceof Error ? error.message : "Invalid path");
  }
  const username = input.username.trim();
  if (!username || username.length > 64) throw new ValidationError("SSH-Benutzer fehlt");
  if (!input.password || input.password.length > 512) throw new ValidationError("SSH-Passwort fehlt");
  const id = randomBytes(24).toString("base64url");
  tickets.set(id, {
    id,
    userId: input.userId,
    hostId: input.hostId,
    kind: input.kind,
    node: input.node,
    vmid: input.vmid,
    path,
    target,
    port,
    username,
    password: input.password,
    expiresAt: input.expiresAt ?? Date.now() + GUEST_DOWNLOAD_TICKET_TTL_MS,
  });
  return { ticket: id, path, name: guestFileName(path) };
}

export function takeGuestDownloadTicket(id: string, userId: string): GuestDownloadTicket {
  pruneTickets();
  const row = tickets.get(id);
  if (!row || row.userId !== userId || row.expiresAt <= Date.now()) {
    tickets.delete(id);
    throw new NotFoundError("Download abgelaufen oder ungültig");
  }
  tickets.delete(id);
  return row;
}
