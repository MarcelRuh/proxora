import { HostConnectionState, HostOrigin, WireguardPeerKind, type WireguardPeer } from "@prisma/client";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import {
  isPeerUpdating,
  PEER_UPDATE_LAST_ERROR,
  peerUpdateDeadline,
  peerUpdateRangeSuffix,
} from "@/lib/peer-update";
import { dispatchNotification, notifyTopic } from "@/server/notifications/dispatch";
import { outboundToken, peerHttpBase } from "@/server/services/wireguard-service";

export type PeerUpdateSignal = {
  updating: boolean;
  from?: string | null;
  to?: string | null;
};

const ANNOUNCE_TIMEOUT_MS = 5_000;

export async function applyIncomingPeerUpdate(peer: WireguardPeer, signal: PeerUpdateSignal): Promise<void> {
  if (signal.updating) {
    const already = isPeerUpdating(peer.updatingUntil);
    await prisma.wireguardPeer.update({
      where: { id: peer.id },
      data: {
        updatingUntil: peerUpdateDeadline(),
        updatingFrom: signal.from?.trim() || null,
        updatingTo: signal.to?.trim() || null,
        lastSeenAt: new Date(),
      },
    });
    await prisma.host.updateMany({
      where: { peerId: peer.id, origin: HostOrigin.PEER },
      data: { connectionState: HostConnectionState.MAINTENANCE, lastError: PEER_UPDATE_LAST_ERROR },
    });
    if (already) return;
    notifyTopic("peer.update", {
      level: "warning",
      title: "Proxora-Update",
      message: `${peer.name} aktualisiert Proxora${peerUpdateRangeSuffix(signal.from, signal.to)}. Geteilte Hosts sind kurz nicht erreichbar — das ist kein Ausfall.`,
      name: peer.name,
      host: peer.name,
    });
    return;
  }
  await finishPeerUpdate(peer, "recovered");
}

export async function finishPeerUpdate(peer: WireguardPeer, outcome: "recovered" | "expired"): Promise<boolean> {
  const cleared = await prisma.wireguardPeer.updateMany({
    where: { id: peer.id, updatingUntil: { not: null } },
    data: { updatingUntil: null, updatingFrom: null, updatingTo: null },
  });
  if (cleared.count === 0) return false;
  await prisma.host.updateMany({
    where: {
      peerId: peer.id,
      origin: HostOrigin.PEER,
      connectionState: HostConnectionState.MAINTENANCE,
    },
    data:
      outcome === "expired"
        ? { connectionState: HostConnectionState.ERROR, lastError: "Peer did not return after Proxora update" }
        : { connectionState: HostConnectionState.CONNECTING, lastError: null },
  });
  if (outcome === "expired") {
    notifyTopic("peer.update", {
      level: "warning",
      title: "Proxora-Update",
      message: `${peer.name} nach dem Update weiter nicht erreichbar. Hosts werden wieder geprüft.`,
      name: peer.name,
      host: peer.name,
    });
  } else {
    notifyTopic("peer.update", {
      level: "success",
      title: "Proxora-Update",
      message: `${peer.name} ist nach dem Proxora-Update wieder erreichbar.`,
      name: peer.name,
      host: peer.name,
    });
  }
  return true;
}

export async function expireStalePeerUpdates(now = new Date()): Promise<void> {
  const stale = await prisma.wireguardPeer.findMany({
    where: { updatingUntil: { lte: now } },
  });
  for (const peer of stale) {
    await finishPeerUpdate(peer, "expired");
  }
}

export async function absorbPeerUpdateOutage(hostId: string): Promise<boolean> {
  const host = await prisma.host.findUnique({
    where: { id: hostId },
    select: { id: true, origin: true, peerId: true, connectionState: true },
  });
  if (!host || host.origin !== HostOrigin.PEER || !host.peerId) return false;
  const peer = await prisma.wireguardPeer.findUnique({
    where: { id: host.peerId },
    select: { updatingUntil: true },
  });
  if (!isPeerUpdating(peer?.updatingUntil ?? null)) return false;
  if (host.connectionState !== HostConnectionState.MAINTENANCE) {
    await prisma.host.update({
      where: { id: host.id },
      data: { connectionState: HostConnectionState.MAINTENANCE, lastError: PEER_UPDATE_LAST_ERROR },
    });
  }
  return true;
}

export async function notePeerHostReachable(peerId: string | null | undefined): Promise<void> {
  if (!peerId) return;
  const peer = await prisma.wireguardPeer.findUnique({ where: { id: peerId } });
  if (!peer?.updatingUntil) return;
  await finishPeerUpdate(peer, "recovered");
}

export async function announcePeerUpdateToPeers(signal: PeerUpdateSignal): Promise<void> {
  const peers = await prisma.wireguardPeer.findMany({ where: { kind: WireguardPeerKind.PROXORA } });
  const results = await Promise.allSettled(
    peers.map(async (peer) => {
      if (!peer.encryptedOutboundToken || !peer.address) return;
      const token = outboundToken(peer);
      const res = await fetch(`${peerHttpBase(peer)}/api/federation/peer-status`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          updating: signal.updating,
          from: signal.from ?? null,
          to: signal.to ?? null,
        }),
        signal: AbortSignal.timeout(ANNOUNCE_TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    }),
  );
  for (const [index, result] of results.entries()) {
    if (result.status === "rejected") {
      logger.warn(
        { peer: peers[index]?.name, err: result.reason instanceof Error ? result.reason.message : result.reason },
        "Peer update announce failed",
      );
    }
  }
}

export async function broadcastSelfUpdate(signal: PeerUpdateSignal): Promise<void> {
  if (signal.updating) {
    await dispatchNotification({
      topic: "peer.update",
      level: "warning",
      title: "Proxora-Update",
      message: `Diese Instanz wird aktualisiert${peerUpdateRangeSuffix(signal.from, signal.to)}. Geteilte Hosts sind bei Kollegen kurz in Wartung.`,
      name: "Proxora",
    }).catch((error) => {
      logger.warn({ err: error }, "Local update notification failed");
    });
  }
  await announcePeerUpdateToPeers(signal);
}
