import { randomBytes } from "node:crypto";
import { NotFoundError, ValidationError } from "@/lib/errors";
import {
  clampSftpPort,
  guestFileName,
  isAllowedSftpTarget,
  resolveGuestPath,
  type GuestTransferMode,
} from "@/lib/guest-files";

export const GUEST_TRANSFER_TICKET_TTL_MS = 120_000;
export const GUEST_TRANSFER_META_HEADER = "x-proxora-guest-files";

export type GuestTransferTicket = {
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
  mode: GuestTransferMode;
  expiresAt: number;
};

const tickets = new Map<string, GuestTransferTicket>();

function pruneTickets(now = Date.now()) {
  for (const [id, row] of tickets) {
    if (row.expiresAt <= now) tickets.delete(id);
  }
}

export function createGuestTransferTicket(
  input: Omit<GuestTransferTicket, "id" | "expiresAt" | "path" | "target" | "port"> & {
    path: string;
    target: string;
    port?: number;
    expiresAt?: number;
  },
): { ticket: string; path: string; name: string; mode: GuestTransferMode } {
  pruneTickets();
  if (input.mode !== "download" && input.mode !== "upload") {
    throw new ValidationError("Ungültiger Transfer");
  }
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
    mode: input.mode,
    expiresAt: input.expiresAt ?? Date.now() + GUEST_TRANSFER_TICKET_TTL_MS,
  });
  return { ticket: id, path, name: guestFileName(path), mode: input.mode };
}

export function takeGuestTransferTicket(id: string, userId: string, mode: GuestTransferMode): GuestTransferTicket {
  pruneTickets();
  const row = tickets.get(id);
  if (!row || row.userId !== userId || row.mode !== mode || row.expiresAt <= Date.now()) {
    tickets.delete(id);
    throw new NotFoundError("Transfer abgelaufen oder ungültig");
  }
  tickets.delete(id);
  return row;
}

/** @deprecated use createGuestTransferTicket */
export function createGuestDownloadTicket(
  input: Omit<GuestTransferTicket, "id" | "expiresAt" | "path" | "target" | "port" | "mode"> & {
    path: string;
    target: string;
    port?: number;
    expiresAt?: number;
  },
) {
  return createGuestTransferTicket({ ...input, mode: "download" });
}

/** @deprecated use takeGuestTransferTicket */
export function takeGuestDownloadTicket(id: string, userId: string) {
  return takeGuestTransferTicket(id, userId, "download");
}

export function encodeGuestTransferMeta(meta: unknown): string {
  return Buffer.from(JSON.stringify(meta), "utf8").toString("base64url");
}

export function decodeGuestTransferMeta(raw: string): unknown {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 16_384) throw new Error("Invalid transfer meta");
  return JSON.parse(Buffer.from(trimmed, "base64url").toString("utf8"));
}
