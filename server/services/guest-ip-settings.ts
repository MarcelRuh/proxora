import { HostOrigin } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  GUEST_IP_SETTING_KEY,
  networksForHost,
  parseGuestIpNetworks,
  parseGuestIpSettings,
  resolveGuestNetworks,
  type GuestIpNetwork,
  type GuestIpSettings,
} from "@/lib/create-ip";
import { logger } from "@/lib/logger";
import { outboundToken, peerHttpBase } from "@/server/services/wireguard-service";

export async function loadGuestIpSettings(): Promise<GuestIpSettings> {
  const row = await prisma.setting.findUnique({ where: { key: GUEST_IP_SETTING_KEY } });
  return parseGuestIpSettings(row?.value);
}

async function saveGuestIpSettings(settings: GuestIpSettings): Promise<void> {
  await prisma.setting.upsert({
    where: { key: GUEST_IP_SETTING_KEY },
    update: { value: settings as object },
    create: { key: GUEST_IP_SETTING_KEY, value: settings as object },
  });
}

export async function cachePeerHostNetworks(localHostId: string, networks: GuestIpNetwork[]): Promise<void> {
  const nets = parseGuestIpNetworks(networks);
  if (!nets.length) return;
  const settings = await loadGuestIpSettings();
  const prev = settings.byHost[localHostId];
  if (
    prev &&
    prev.length === nets.length &&
    prev.every((n, i) => n.id === nets[i]?.id && n.prefix === nets[i]?.prefix && n.gateway === nets[i]?.gateway)
  ) {
    return;
  }
  await saveGuestIpSettings({ ...settings, byHost: { ...settings.byHost, [localHostId]: nets } });
}

export async function forgetPeerHostNetworks(localHostIds: string[]): Promise<void> {
  if (!localHostIds.length) return;
  const settings = await loadGuestIpSettings();
  let changed = false;
  const byHost = { ...settings.byHost };
  for (const id of localHostIds) {
    if (id in byHost) {
      delete byHost[id];
      changed = true;
    }
  }
  if (changed) await saveGuestIpSettings({ ...settings, byHost });
}

async function fetchPeerGuestNetworks(peerId: string, remoteHostId: string): Promise<GuestIpNetwork[] | null> {
  const peer = await prisma.wireguardPeer.findUnique({ where: { id: peerId } });
  if (!peer?.encryptedOutboundToken || !peer.address) return null;
  const token = outboundToken(peer);
  const url = new URL("/api/federation/guest-networks", peerHttpBase(peer));
  url.searchParams.set("hostId", remoteHostId);
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) return null;
  const json = (await res.json()) as { networks?: unknown };
  const nets = parseGuestIpNetworks(json.networks);
  return nets.length ? nets : null;
}

export async function networksForHostId(hostId: string): Promise<GuestIpNetwork[]> {
  const host = await prisma.host.findUnique({ where: { id: hostId } });
  const settings = await loadGuestIpSettings();
  if (host?.origin === HostOrigin.PEER && host.peerId && host.remoteHostId) {
    try {
      const live = await fetchPeerGuestNetworks(host.peerId, host.remoteHostId);
      if (live?.length) {
        void cachePeerHostNetworks(host.id, live).catch((error) => {
          logger.warn(
            { hostId: host.id, err: error instanceof Error ? error.message : error },
            "Could not cache peer guest networks",
          );
        });
        return resolveGuestNetworks(settings, hostId, live);
      }
    } catch (error) {
      logger.warn(
        { host: host.name, err: error instanceof Error ? error.message : error },
        "Peer guest networks fetch failed",
      );
    }
  }
  return resolveGuestNetworks(settings, hostId);
}
