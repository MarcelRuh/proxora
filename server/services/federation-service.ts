import { HostOrigin, PeerShareLevel, WireguardPeerKind, type Host } from "@prisma/client";
import { prisma } from "@/lib/db";
import { encryptSecret } from "@/lib/crypto";
import { ForbiddenError, NotFoundError, UnauthorizedError, ValidationError } from "@/lib/errors";
import { networksForHost, parseGuestIpNetworks } from "@/lib/create-ip";
import { guestFilePermission, sanitizePermissions } from "@/lib/permissions";
import {
  effectiveSharePermissions,
  federationPermission,
  parseShareLevel,
  shareHasPermission,
  shareLevelFromPermissions,
  type ShareLevel,
} from "@/lib/federation-access";
import { logger } from "@/lib/logger";
import {
  cachePeerHostNetworks,
  forgetPeerHostNetworks,
  loadGuestIpSettings,
} from "@/server/services/guest-ip-settings";
import { findPeerByInboundToken, outboundToken, peerHttpBase } from "@/server/services/wireguard-service";
import { clientForHost } from "@/server/services/host-service";
import type { WireguardPeer } from "@prisma/client";

function bearerToken(request: Request): string {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  const token = match?.[1]?.trim() ?? "";
  if (!token) throw new UnauthorizedError("Federation token required");
  return token;
}

export async function requireFederationPeer(request: Request): Promise<WireguardPeer> {
  const peer = await findPeerByInboundToken(bearerToken(request));
  if (!peer || peer.kind !== WireguardPeerKind.PROXORA) throw new UnauthorizedError("Unknown federation peer");
  await prisma.wireguardPeer.update({ where: { id: peer.id }, data: { lastSeenAt: new Date() } }).catch(() => undefined);
  return peer;
}

export async function requireSharedGuestFiles(request: Request, remoteHostId: string, kind: "vm" | "lxc") {
  const peer = await requireFederationPeer(request);
  const share = await prisma.hostShare.findUnique({
    where: { peerId_hostId: { peerId: peer.id, hostId: remoteHostId } },
    include: { host: true },
  });
  if (!share || share.host.origin !== HostOrigin.LOCAL) throw new NotFoundError("Host not shared");
  const level = parseShareLevel(String(share.level)) ?? "view";
  const needed = [guestFilePermission(kind, "read"), guestFilePermission(kind, "write")];
  if (!shareHasPermission(level, share.permissions, needed)) {
    throw new ForbiddenError("This host is not shared at that level");
  }
  return { peer, host: share.host };
}

function prismaLevel(level: PeerShareLevel): ShareLevel {
  return level.toLowerCase() as ShareLevel;
}

export async function listSharedHostsForPeer(peer: WireguardPeer) {
  const settings = await loadGuestIpSettings();
  const shares = await prisma.hostShare.findMany({
    where: { peerId: peer.id },
    include: { host: true },
  });
  return shares
    .filter((s) => s.host.origin === HostOrigin.LOCAL)
    .map((s) => ({
      id: s.host.id,
      name: s.host.name,
      connectionState: s.host.connectionState,
      proxmoxVersion: s.host.proxmoxVersion,
      shareLevel: prismaLevel(s.level),
      permissions: effectiveSharePermissions(prismaLevel(s.level), s.permissions),
      networks: networksForHost(settings, s.host.id),
    }));
}

export async function assertSharedHost(
  peer: WireguardPeer,
  remoteHostId: string,
  method: string,
  path: string,
  extra?: { query?: Record<string, string>; body?: Record<string, unknown> | null },
) {
  const share = await prisma.hostShare.findUnique({
    where: { peerId_hostId: { peerId: peer.id, hostId: remoteHostId } },
    include: { host: true },
  });
  if (!share || share.host.origin !== HostOrigin.LOCAL) throw new NotFoundError("Host not shared");
  const needed = federationPermission(method, path, extra);
  if (needed === "deny" || !shareHasPermission(prismaLevel(share.level), share.permissions, needed)) {
    throw new ForbiddenError("This host is not shared at that level");
  }
  return share.host;
}

export async function proxyPveRequest(host: Host, method: string, path: string, query?: Record<string, string>, body?: Record<string, unknown>) {
  if (!path.startsWith("/") || path.includes("..")) throw new ValidationError("Invalid Proxmox path");
  const client = await clientForHost(host);
  const verb = method.toUpperCase();
  if (verb === "GET") return client.http.get(path, query);
  if (verb === "POST") return client.http.post(path, body, query);
  if (verb === "PUT") return client.http.put(path, body, query);
  if (verb === "DELETE") return client.http.del(path, query);
  throw new ValidationError(`Unsupported method ${method}`);
}

export async function syncPeerHosts() {
  const peers = await prisma.wireguardPeer.findMany({ where: { kind: WireguardPeerKind.PROXORA } });
  for (const peer of peers) {
    if (!peer.encryptedOutboundToken || !peer.address) continue;
    try {
      const token = outboundToken(peer);
      const res = await fetch(`${peerHttpBase(peer)}/api/federation/hosts`, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
        signal: AbortSignal.timeout(12_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as {
        hosts?: Array<{
          id: string;
          name: string;
          connectionState?: string;
          proxmoxVersion?: string | null;
          shareLevel?: string;
          permissions?: unknown;
          networks?: unknown;
        }>;
      };
      const remote = json.hosts ?? [];
      const remoteIds = new Set(remote.map((h) => h.id));
      const existing = await prisma.host.findMany({ where: { peerId: peer.id, origin: HostOrigin.PEER } });
      const removedIds: string[] = [];
      for (const row of existing) {
        if (row.remoteHostId && !remoteIds.has(row.remoteHostId)) {
          removedIds.push(row.id);
          await prisma.host.delete({ where: { id: row.id } });
        }
      }
      if (removedIds.length) await forgetPeerHostNetworks(removedIds);
      for (const item of remote) {
        const perms = Array.isArray(item.permissions) ? sanitizePermissions(item.permissions) : [];
        const shareLevel = parseShareLevel(item.shareLevel) ?? (perms.length ? shareLevelFromPermissions(perms) : null);
        if (!shareLevel) continue;
        const level = shareLevel.toUpperCase() as PeerShareLevel;
        const url = `federation://${peer.id}/${item.id}`;
        const host = await prisma.host.upsert({
          where: { peerId_remoteHostId: { peerId: peer.id, remoteHostId: item.id } },
          create: {
            name: item.name,
            url,
            authType: "API_TOKEN",
            username: "peer@pve",
            tokenId: "federation",
            encryptedSecret: encryptSecret("federation"),
            allowInsecureTls: true,
            origin: HostOrigin.PEER,
            peerId: peer.id,
            remoteHostId: item.id,
            peerShareLevel: level,
            peerSharePermissions: perms,
            connectionState: item.connectionState === "ONLINE" ? "ONLINE" : "CONNECTING",
            proxmoxVersion: item.proxmoxVersion ?? null,
          },
          update: {
            name: item.name,
            peerShareLevel: level,
            peerSharePermissions: perms,
            proxmoxVersion: item.proxmoxVersion ?? undefined,
            connectionState: item.connectionState === "ONLINE" ? "ONLINE" : undefined,
          },
        });
        const nets = parseGuestIpNetworks(item.networks);
        if (nets.length) await cachePeerHostNetworks(host.id, nets);
      }
      await prisma.wireguardPeer.update({ where: { id: peer.id }, data: { lastSeenAt: new Date() } });
    } catch (error) {
      logger.warn({ peer: peer.name, err: error instanceof Error ? error.message : error }, "Peer host sync failed");
    }
  }
}
