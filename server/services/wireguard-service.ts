import { mkdir, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import { PeerShareLevel, WireguardPeerKind, type WireguardPeer } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { decryptSecret, encryptSecret, randomToken, sha256 } from "@/lib/crypto";
import { ValidationError, NotFoundError } from "@/lib/errors";
import { encodeWireguardInvite, parseWireguardInvite } from "@/lib/wireguard-invite";
import { buildWg0Conf, parseWgQuickConf, sanitizeClientAllowedIps, serverPeerSnippet } from "@/lib/wireguard-conf";
import { generateWireguardKeypair, interfaceIpv4, isWireguardKey, peerAllowedIps, publicKeyFromPrivate } from "@/lib/wireguard-keys";

export const WG_SETTING_KEY = "wireguard";
export const WG_CONFIG_DIR = process.env.WG_CONFIG_DIR ?? "/wireguard";

export type WireguardInterfaceSettings = {
  enabled: boolean;
  instanceName: string;
  address: string;
  publicKey: string;
  encryptedPrivateKey: string;
  serverPublicKey: string;
  serverEndpoint: string;
  allowedIPs: string;
  persistentKeepalive: number;
  encryptedPresharedKey: string;
};

const interfacePatchSchema = z.object({
  enabled: z.boolean().optional(),
  instanceName: z.string().min(1).max(80).optional(),
  address: z.string().min(7).max(48).optional(),
  serverPublicKey: z.string().max(64).optional(),
  serverEndpoint: z.string().max(200).optional(),
  allowedIPs: z.string().max(400).optional(),
  persistentKeepalive: z.number().int().min(0).max(120).optional(),
});

const gatewaySchema = z.object({
  name: z.string().min(1).max(80),
  publicKey: z.string().min(1),
  endpoint: z.string().min(1).max(200),
  allowedIPs: z.string().min(1).max(400),
});

export function defaultInterfaceSettings(): WireguardInterfaceSettings {
  const keys = generateWireguardKeypair();
  return {
    enabled: false,
    instanceName: "Proxora",
    address: "10.88.0.2/24",
    publicKey: keys.publicKey,
    encryptedPrivateKey: encryptSecret(keys.privateKey),
    serverPublicKey: "",
    serverEndpoint: "",
    allowedIPs: "10.88.0.0/24",
    persistentKeepalive: 25,
    encryptedPresharedKey: "",
  };
}

export async function loadWireguardInterface(): Promise<WireguardInterfaceSettings> {
  const row = await prisma.setting.findUnique({ where: { key: WG_SETTING_KEY } });
  if (!row || typeof row.value !== "object" || row.value === null) {
    const created = defaultInterfaceSettings();
    await prisma.setting.create({ data: { key: WG_SETTING_KEY, value: created } });
    return created;
  }
  const rec = row.value as Record<string, unknown>;
  if (typeof rec.encryptedPrivateKey !== "string" || typeof rec.publicKey !== "string") {
    const created = defaultInterfaceSettings();
    await prisma.setting.upsert({
      where: { key: WG_SETTING_KEY },
      create: { key: WG_SETTING_KEY, value: created },
      update: { value: created },
    });
    return created;
  }
  let serverPublicKey = String(rec.serverPublicKey ?? "").trim();
  let serverEndpoint = String(rec.serverEndpoint ?? rec.endpoint ?? "").trim();
  let allowedIPs = String(rec.allowedIPs ?? "10.88.0.0/24").trim() || "10.88.0.0/24";
  if (!serverPublicKey) {
    const gateway = await prisma.wireguardPeer.findFirst({
      where: { kind: WireguardPeerKind.GATEWAY },
      orderBy: { createdAt: "asc" },
    });
    if (gateway) {
      serverPublicKey = gateway.publicKey;
      serverEndpoint = gateway.endpoint || serverEndpoint;
      allowedIPs = gateway.allowedIPs.trim() || allowedIPs;
    }
  }
  return {
    enabled: Boolean(rec.enabled),
    instanceName: String(rec.instanceName ?? "Proxora").trim() || "Proxora",
    address: String(rec.address ?? "10.88.0.2/24"),
    publicKey: String(rec.publicKey),
    encryptedPrivateKey: String(rec.encryptedPrivateKey),
    serverPublicKey,
    serverEndpoint,
    allowedIPs,
    persistentKeepalive: Number(rec.persistentKeepalive ?? 25) || 25,
    encryptedPresharedKey: String(rec.encryptedPresharedKey ?? ""),
  };
}

async function saveInterface(next: WireguardInterfaceSettings) {
  await prisma.setting.upsert({
    where: { key: WG_SETTING_KEY },
    create: { key: WG_SETTING_KEY, value: next },
    update: { value: next },
  });
  await writeWireguardConfig(next);
}

export async function patchWireguardInterface(input: unknown) {
  const patch = interfacePatchSchema.parse(input);
  const current = await loadWireguardInterface();
  if (patch.address && !interfaceIpv4(patch.address)) {
    throw new ValidationError("WireGuard address must be IPv4 CIDR, e.g. 10.88.0.2/24");
  }
  if (patch.serverPublicKey && patch.serverPublicKey.trim() && !isWireguardKey(patch.serverPublicKey)) {
    throw new ValidationError("Invalid WireGuard server public key");
  }
  const next: WireguardInterfaceSettings = { ...current, ...patch };
  await saveInterface(next);
  return publicInterface(next);
}

export function publicInterface(cfg: WireguardInterfaceSettings) {
  return {
    enabled: cfg.enabled,
    instanceName: cfg.instanceName,
    address: cfg.address,
    publicKey: cfg.publicKey,
    serverPublicKey: cfg.serverPublicKey,
    serverEndpoint: cfg.serverEndpoint,
    allowedIPs: cfg.allowedIPs,
    persistentKeepalive: cfg.persistentKeepalive,
    hasPresharedKey: Boolean(cfg.encryptedPresharedKey),
    serverPeerSnippet: serverPeerSnippet(cfg.publicKey, cfg.address),
  };
}

export async function writeWireguardConfig(cfg?: WireguardInterfaceSettings) {
  const settings = cfg ?? (await loadWireguardInterface());
  await mkdir(WG_CONFIG_DIR, { recursive: true });
  const disabledPath = path.join(WG_CONFIG_DIR, "disabled");
  if (!settings.enabled) {
    await writeFile(disabledPath, "1\n", "utf8");
    return;
  }
  await unlink(disabledPath).catch(() => undefined);
  const privateKey = decryptSecret(settings.encryptedPrivateKey);
  const gateways = await prisma.wireguardPeer.findMany({
    where: { kind: WireguardPeerKind.GATEWAY },
    orderBy: { name: "asc" },
  });
  const peers = [];
  const psk = settings.encryptedPresharedKey ? decryptSecret(settings.encryptedPresharedKey) : undefined;
  if (settings.serverPublicKey && settings.serverEndpoint) {
    peers.push({
      publicKey: settings.serverPublicKey,
      endpoint: settings.serverEndpoint,
      allowedIPs: settings.allowedIPs || "10.88.0.0/24",
      persistentKeepalive: settings.persistentKeepalive,
      presharedKey: psk,
    });
  }
  for (const peer of gateways) {
    const allowed = peerAllowedIps(peer.address, peer.allowedIPs);
    if (!allowed) continue;
    peers.push({
      publicKey: peer.publicKey,
      endpoint: peer.endpoint,
      allowedIPs: allowed,
      persistentKeepalive: peer.persistentKeepalive || 25,
    });
  }
  const confPath = path.join(WG_CONFIG_DIR, "wg0.conf");
  await writeFile(confPath, buildWg0Conf({ privateKey, address: settings.address, peers }), {
    encoding: "utf8",
    mode: 0o600,
  });
}

export function serializePeer(peer: WireguardPeer) {
  return {
    id: peer.id,
    name: peer.name,
    kind: peer.kind,
    publicKey: peer.publicKey,
    endpoint: peer.endpoint,
    address: peer.address,
    allowedIPs: peer.allowedIPs,
    paired: Boolean(peer.publicKey && peer.encryptedOutboundToken),
    lastSeenAt: peer.lastSeenAt?.toISOString() ?? null,
  };
}

export function buildInvite(cfg: WireguardInterfaceSettings, token: string) {
  const ip = interfaceIpv4(cfg.address) ?? "10.88.0.2";
  return encodeWireguardInvite({
    v: 1,
    name: cfg.instanceName,
    publicKey: cfg.publicKey,
    endpoint: cfg.serverEndpoint,
    address: ip,
    listenPort: 51820,
    token,
  });
}

export async function createProxoraPeer(name: string) {
  const cfg = await loadWireguardInterface();
  const inbound = randomToken(32);
  const peer = await prisma.wireguardPeer.create({
    data: {
      name: name.trim(),
      kind: WireguardPeerKind.PROXORA,
      inboundTokenHash: sha256(inbound),
      encryptedInboundToken: encryptSecret(inbound),
    },
  });
  return { peer: serializePeer(peer), invite: buildInvite(cfg, inbound) };
}

export async function addGatewayPeer(input: unknown) {
  const body = gatewaySchema.parse(input);
  if (!isWireguardKey(body.publicKey)) throw new ValidationError("Invalid WireGuard public key");
  const current = await loadWireguardInterface();
  const next: WireguardInterfaceSettings = {
    ...current,
    serverPublicKey: body.publicKey.trim(),
    serverEndpoint: body.endpoint.trim(),
    allowedIPs: body.allowedIPs.trim() || current.allowedIPs,
  };
  await saveInterface(next);
  return publicInterface(next);
}

export async function importWireguardConf(raw: string) {
  let parsed;
  try {
    parsed = parseWgQuickConf(raw);
  } catch (e) {
    throw new ValidationError(e instanceof Error ? e.message : "Invalid WireGuard config");
  }
  const peer = parsed.peers.find((p) => p.endpoint) ?? parsed.peers[0];
  if (!peer?.endpoint) {
    throw new ValidationError("Client config needs a [Peer] with Endpoint");
  }
  let publicKey: string;
  try {
    publicKey = publicKeyFromPrivate(parsed.privateKey);
  } catch {
    throw new ValidationError("Invalid PrivateKey");
  }
  const current = await loadWireguardInterface();
  const next: WireguardInterfaceSettings = {
    ...current,
    enabled: true,
    address: parsed.address,
    publicKey,
    encryptedPrivateKey: encryptSecret(parsed.privateKey),
    serverPublicKey: peer.publicKey,
    serverEndpoint: peer.endpoint,
    allowedIPs: sanitizeClientAllowedIps(peer.allowedIPs, parsed.address),
    persistentKeepalive: peer.persistentKeepalive ?? 25,
    encryptedPresharedKey: peer.presharedKey ? encryptSecret(peer.presharedKey) : "",
  };
  await saveInterface(next);
  return publicInterface(next);
}

export async function importWireguardInvite(raw: string) {
  let invite;
  try {
    invite = parseWireguardInvite(raw);
  } catch {
    throw new ValidationError("Invalid invite");
  }
  const cfg = await loadWireguardInterface();
  const ourIp = interfaceIpv4(cfg.address);
  const theirIp = interfaceIpv4(invite.address.includes("/") ? invite.address : `${invite.address}/32`);
  if (ourIp && theirIp && ourIp === theirIp) {
    throw new ValidationError("Both Proxoras use the same WireGuard address. Change yours (e.g. 10.88.0.2/24).");
  }
  const existingKey = await prisma.wireguardPeer.findFirst({
    where: { publicKey: invite.publicKey, kind: WireguardPeerKind.PROXORA },
  });
  const inbound = randomToken(32);
  const data = {
    name: invite.name,
    kind: WireguardPeerKind.PROXORA,
    publicKey: invite.publicKey,
    endpoint: "",
    address: theirIp ?? invite.address,
    allowedIPs: "",
    encryptedOutboundToken: encryptSecret(invite.token),
  };
  const peer = existingKey
    ? await prisma.wireguardPeer.update({ where: { id: existingKey.id }, data })
    : await prisma.wireguardPeer.create({
        data: {
          ...data,
          inboundTokenHash: sha256(inbound),
          encryptedInboundToken: encryptSecret(inbound),
        },
      });
  await writeWireguardConfig();
  const token = decryptSecret(peer.encryptedInboundToken);
  return { peer: serializePeer(peer), invite: buildInvite(cfg, token) };
}

export async function inviteForPeer(peerId: string) {
  const cfg = await loadWireguardInterface();
  const peer = await prisma.wireguardPeer.findUnique({ where: { id: peerId } });
  if (!peer) throw new NotFoundError("Peer not found");
  if (peer.kind !== WireguardPeerKind.PROXORA) throw new ValidationError("Only Proxora peers have invites");
  return buildInvite(cfg, decryptSecret(peer.encryptedInboundToken));
}

export async function deletePeer(id: string) {
  const peer = await prisma.wireguardPeer.findUnique({ where: { id } });
  if (!peer) throw new NotFoundError("Peer not found");
  await prisma.wireguardPeer.delete({ where: { id } });
  await writeWireguardConfig();
}

export async function listPeersWithShares() {
  const peers = await prisma.wireguardPeer.findMany({
    orderBy: { name: "asc" },
    include: { shares: true },
  });
  return peers.map((p) => ({
    ...serializePeer(p),
    shares: p.shares.map((s) => ({ hostId: s.hostId, level: s.level.toLowerCase() })),
  }));
}

export async function setPeerShares(peerId: string, shares: Array<{ hostId: string; level: string }>) {
  const peer = await prisma.wireguardPeer.findUnique({ where: { id: peerId } });
  if (!peer) throw new NotFoundError("Peer not found");
  if (peer.kind !== WireguardPeerKind.PROXORA) throw new ValidationError("Only Proxora peers can receive host shares");
  const levels: Record<string, PeerShareLevel> = {
    view: PeerShareLevel.VIEW,
    control: PeerShareLevel.CONTROL,
    create: PeerShareLevel.CREATE,
  };
  const localHosts = await prisma.host.findMany({ where: { origin: "LOCAL" }, select: { id: true } });
  const localIds = new Set(localHosts.map((h) => h.id));
  const next = shares
    .map((s) => ({ hostId: s.hostId, level: levels[s.level.toLowerCase()] }))
    .filter((s): s is { hostId: string; level: PeerShareLevel } => Boolean(s.level) && localIds.has(s.hostId));
  await prisma.$transaction([
    prisma.hostShare.deleteMany({ where: { peerId } }),
    ...next.map((s) =>
      prisma.hostShare.create({ data: { peerId, hostId: s.hostId, level: s.level } }),
    ),
  ]);
  return listPeersWithShares();
}

export async function findPeerByInboundToken(token: string) {
  const hash = sha256(token);
  return prisma.wireguardPeer.findUnique({ where: { inboundTokenHash: hash } });
}

export function peerHttpBase(address: string): string {
  const ip = interfaceIpv4(address.includes("/") ? address : `${address}/32`) ?? address.trim();
  const port = process.env.PORT ?? "3000";
  return `http://${ip}:${port}`;
}

export function outboundToken(peer: WireguardPeer): string {
  if (!peer.encryptedOutboundToken) throw new ValidationError("Peer is not paired yet — import their invite");
  return decryptSecret(peer.encryptedOutboundToken);
}
