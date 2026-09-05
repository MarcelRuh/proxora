import { HostOrigin, PeerShareLevel, WireguardPeerKind, type Host } from "@prisma/client";
import { prisma } from "@/lib/db";
import { encryptSecret, decryptSecret } from "@/lib/crypto";
import { ForbiddenError, NotFoundError, UnauthorizedError, ValidationError } from "@/lib/errors";
import { federationActionLevel, parseShareLevel, shareAllows, type ShareLevel } from "@/lib/federation-access";
import { logger } from "@/lib/logger";
import { findPeerByInboundToken, outboundToken, peerHttpBase } from "@/server/services/wireguard-service";
import { clientConfigFromHost } from "@/server/services/host-service";
import { createProxmoxClient } from "@/server/proxmox/client";
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

function prismaLevel(level: PeerShareLevel): ShareLevel {
  return level.toLowerCase() as ShareLevel;
}

export async function listSharedHostsForPeer(peer: WireguardPeer) {
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
    }));
}

export async function assertSharedHost(peer: WireguardPeer, remoteHostId: string, method: string, path: string) {
  const share = await prisma.hostShare.findUnique({
    where: { peerId_hostId: { peerId: peer.id, hostId: remoteHostId } },
    include: { host: true },
  });
  if (!share || share.host.origin !== HostOrigin.LOCAL) throw new NotFoundError("Host not shared");
  const needed = federationActionLevel(method, path);
  if (!shareAllows(prismaLevel(share.level), needed)) {
    throw new ForbiddenError("This host is not shared at that level");
  }
  return share.host;
}

export async function proxyPveRequest(host: Host, method: string, path: string, query?: Record<string, string>, body?: Record<string, unknown>) {
  if (!path.startsWith("/") || path.includes("..")) throw new ValidationError("Invalid Proxmox path");
  const secret = decryptSecret(host.encryptedSecret);
  const client = createProxmoxClient(clientConfigFromHost(host, secret));
  try {
    const verb = method.toUpperCase();
    if (verb === "GET") return client.http.get(path, query);
    if (verb === "POST") return client.http.post(path, body, query);
    if (verb === "PUT") return client.http.put(path, body, query);
    if (verb === "DELETE") return client.http.del(path, query);
    throw new ValidationError(`Unsupported method ${method}`);
  } finally {
    client.dispose();
  }
}

export async function syncPeerHosts() {
  const peers = await prisma.wireguardPeer.findMany({ where: { kind: WireguardPeerKind.PROXORA } });
  for (const peer of peers) {
    if (!peer.encryptedOutboundToken || !peer.address) continue;
    try {
      const token = outboundToken(peer);
      const res = await fetch(`${peerHttpBase(peer.address)}/api/federation/hosts`, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
        signal: AbortSignal.timeout(12_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as { hosts?: Array<{ id: string; name: string; connectionState?: string; proxmoxVersion?: string | null; shareLevel?: string }> };
      const remote = json.hosts ?? [];
      const remoteIds = new Set(remote.map((h) => h.id));
      const existing = await prisma.host.findMany({ where: { peerId: peer.id, origin: HostOrigin.PEER } });
      for (const row of existing) {
        if (row.remoteHostId && !remoteIds.has(row.remoteHostId)) {
          await prisma.host.delete({ where: { id: row.id } });
        }
      }
      for (const item of remote) {
        const shareLevel = parseShareLevel(item.shareLevel);
        if (!shareLevel) continue;
        const level = shareLevel.toUpperCase() as PeerShareLevel;
        const url = `federation://${peer.id}/${item.id}`;
        await prisma.host.upsert({
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
            connectionState: item.connectionState === "ONLINE" ? "ONLINE" : "CONNECTING",
            proxmoxVersion: item.proxmoxVersion ?? null,
          },
          update: {
            name: item.name,
            peerShareLevel: level,
            proxmoxVersion: item.proxmoxVersion ?? undefined,
            connectionState: item.connectionState === "ONLINE" ? "ONLINE" : undefined,
          },
        });
      }
      await prisma.wireguardPeer.update({ where: { id: peer.id }, data: { lastSeenAt: new Date() } });
    } catch (error) {
      logger.warn({ peer: peer.name, err: error instanceof Error ? error.message : error }, "Peer host sync failed");
    }
  }
}
