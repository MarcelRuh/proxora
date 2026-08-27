import { AuthType, Host, HostConnectionState } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { ConflictError, HostUnreachableError, NotFoundError, ProxmoxApiError, ValidationError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import type { SessionUser } from "@/server/auth/session-core";
import { canAccessHost } from "@/server/auth/session-core";
import { createProxmoxClient } from "@/server/proxmox/client";
import type { ConnectionTestResult, ProxmoxConnectionConfig } from "@/server/proxmox/types";
import { normalizeProxmoxUsername } from "@/server/proxmox/username";

export const hostInputSchema = z.object({
  name: z.string().min(1).max(80),
  url: z
    .string()
    .min(1)
    .refine((v) => /^https?:\/\//i.test(v) || /^[\w.-]+:\d+$/.test(v) || /^[\w.-]+$/.test(v), {
      message: "Enter a valid host URL, e.g. https://192.168.1.10:8006",
    }),
  authType: z.enum(["API_TOKEN", "PASSWORD"]),
  username: z.string().min(1),
  tokenId: z.string().optional().nullable(),
  secret: z.string().min(1),
  allowInsecureTls: z.boolean().optional().default(false),
  notes: z.string().max(2000).optional().nullable(),
});

export const hostUpdateSchema = hostInputSchema.partial().extend({
  secret: z.string().min(1).optional(),
});

function normalizeUrl(url: string): string {
  const trimmed = url.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed.replace(/\/+$/, "");
  if (/:\d+$/.test(trimmed)) return `https://${trimmed}`;
  return `https://${trimmed}:8006`;
}

export function toPublicHost(host: Host) {
  return {
    id: host.id,
    name: host.name,
    url: host.url,
    authType: host.authType,
    username: host.username,
    tokenId: host.tokenId,
    allowInsecureTls: host.allowInsecureTls,
    connectionState: host.connectionState,
    lastSeenAt: host.lastSeenAt,
    lastError: host.lastError,
    proxmoxVersion: host.proxmoxVersion,
    clusterName: host.clusterName,
    isClusterMember: host.isClusterMember,
    notes: host.notes,
    aptUpdateCount: host.aptUpdateCount,
    aptCheckedAt: host.aptCheckedAt,
    createdAt: host.createdAt,
    updatedAt: host.updatedAt,
  };
}

export function filterHostsForUser<T extends { id: string }>(user: SessionUser, hosts: T[]): T[] {
  if (user.allowedHostIds === null) return hosts;
  return hosts.filter((h) => user.allowedHostIds!.includes(h.id));
}

export async function listHosts(user: SessionUser) {
  const hosts = await prisma.host.findMany({ orderBy: { name: "asc" } });
  return filterHostsForUser(user, hosts).map(toPublicHost);
}

export async function getHostOrThrow(id: string, user?: SessionUser) {
  const host = await prisma.host.findUnique({ where: { id } });
  if (!host) throw new NotFoundError("Host not found");
  if (user && !canAccessHost(user, host.id)) throw new NotFoundError("Host not found");
  return host;
}

export function clientConfigFromHost(host: Host, secret: string): ProxmoxConnectionConfig {
  return {
    url: host.url,
    authType: host.authType,
    username: normalizeProxmoxUsername(host.username),
    tokenId: host.authType === "PASSWORD" ? null : host.tokenId,
    secret,
    allowInsecureTls: host.allowInsecureTls,
  };
}

export async function clientForHost(host: Host) {
  const secret = decryptSecret(host.encryptedSecret);
  return createProxmoxClient(clientConfigFromHost(host, secret));
}

export async function testRawConnection(
  input: z.infer<typeof hostInputSchema>,
): Promise<ConnectionTestResult> {
  const client = createProxmoxClient({
    url: normalizeUrl(input.url),
    authType: input.authType as AuthType,
    username: normalizeProxmoxUsername(input.username),
    tokenId: input.authType === "PASSWORD" ? null : input.tokenId,
    secret: input.secret,
    allowInsecureTls: input.allowInsecureTls,
  });
  return client.testConnection();
}

async function applyTestResult(hostId: string, result: ConnectionTestResult) {
  if (result.ok) {
    await prisma.host.update({
      where: { id: hostId },
      data: {
        connectionState: HostConnectionState.ONLINE,
        lastSeenAt: new Date(),
        lastError: null,
        proxmoxVersion: result.version ? `${result.version.version}` : undefined,
        clusterName: result.cluster?.name ?? null,
        isClusterMember: Boolean(result.cluster?.isCluster),
      },
    });
  } else {
    await prisma.host.update({
      where: { id: hostId },
      data: {
        connectionState: HostConnectionState.ERROR,
        lastError: result.error ?? "Connection failed",
      },
    });
  }
}

export async function createHost(input: z.infer<typeof hostInputSchema>) {
  const url = normalizeUrl(input.url);
  const existing = await prisma.host.findFirst({
    where: { OR: [{ name: input.name }, { url }] },
  });
  if (existing) {
    throw new ConflictError("A host with this name or URL already exists");
  }
  if (input.authType === "API_TOKEN" && !input.tokenId) {
    throw new ValidationError("Token ID is required for API token authentication");
  }
  const username = normalizeProxmoxUsername(input.username);
  const host = await prisma.host.create({
    data: {
      name: input.name,
      url,
      authType: input.authType,
      username,
      tokenId: input.authType === "PASSWORD" ? null : (input.tokenId ?? null),
      encryptedSecret: encryptSecret(input.secret),
      allowInsecureTls: input.allowInsecureTls ?? false,
      notes: input.notes ?? null,
      connectionState: HostConnectionState.CONNECTING,
    },
  });
  const result = await testRawConnection({ ...input, url });
  await applyTestResult(host.id, result);
  return prisma.host.findUniqueOrThrow({ where: { id: host.id } });
}

export async function updateHost(id: string, input: z.infer<typeof hostUpdateSchema>, user: SessionUser) {
  const host = await getHostOrThrow(id, user);
  const data: Record<string, unknown> = {};
  if (input.name) data.name = input.name;
  if (input.url) data.url = normalizeUrl(input.url);
  if (input.authType) data.authType = input.authType;
  if (input.username) data.username = normalizeProxmoxUsername(input.username);
  if (input.authType === "PASSWORD") data.tokenId = null;
  else if (input.tokenId !== undefined) data.tokenId = input.tokenId;
  if (input.allowInsecureTls !== undefined) data.allowInsecureTls = input.allowInsecureTls;
  if (input.notes !== undefined) data.notes = input.notes;
  if (input.secret) data.encryptedSecret = encryptSecret(input.secret);
  const updated = await prisma.host.update({ where: { id: host.id }, data });
  return updated;
}

export async function deleteHost(id: string, user: SessionUser) {
  const host = await getHostOrThrow(id, user);
  await prisma.host.delete({ where: { id: host.id } });
}

export async function testHost(id: string, user: SessionUser) {
  const host = await getHostOrThrow(id, user);
  const secret = decryptSecret(host.encryptedSecret);
  const result = await testRawConnection({
    name: host.name,
    url: host.url,
    authType: host.authType,
    username: host.username,
    tokenId: host.tokenId,
    secret,
    allowInsecureTls: host.allowInsecureTls,
  });
  await applyTestResult(host.id, result);
  return result;
}

export async function probeAllHosts() {
  const hosts = await prisma.host.findMany({ orderBy: { name: "asc" } });
  await Promise.all(
    hosts.map(async (host) => {
      if (host.connectionState === HostConnectionState.MAINTENANCE) return;
      try {
        const secret = decryptSecret(host.encryptedSecret);
        const result = await testRawConnection({
          name: host.name,
          url: host.url,
          authType: host.authType,
          username: host.username,
          tokenId: host.tokenId,
          secret,
          allowInsecureTls: host.allowInsecureTls,
        });
        await applyTestResult(host.id, result);
        logger.info({ host: host.name, ok: result.ok }, "Host probe finished");
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        logger.warn({ host: host.name, err: message }, "Host probe failed");
        await prisma.host.update({
          where: { id: host.id },
          data: { connectionState: HostConnectionState.ERROR, lastError: message },
        });
      }
    }),
  );
}

export async function withHostClient<T>(
  hostId: string,
  user: SessionUser,
  fn: (client: ReturnType<typeof createProxmoxClient>, host: Host) => Promise<T>,
): Promise<T> {
  const host = await getHostOrThrow(hostId, user);
  try {
    const client = await clientForHost(host);
    const result = await fn(client, host);
    if (host.connectionState !== HostConnectionState.ONLINE) {
      await prisma.host.update({
        where: { id: host.id },
        data: { connectionState: HostConnectionState.ONLINE, lastSeenAt: new Date(), lastError: null },
      });
    }
    return result;
  } catch (error) {
    if (error instanceof ProxmoxApiError && error.status !== 503) {
      throw error;
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    logger.warn({ host: host.name, err: message }, "Host request failed");
    await prisma.host.update({
      where: { id: host.id },
      data: { connectionState: HostConnectionState.ERROR, lastError: message },
    });
    const { requestHostReconnect } = await import("@/server/services/host-reconnect");
    requestHostReconnect();
    throw new HostUnreachableError(host.name, message);
  }
}

export async function setHostState(id: string, state: HostConnectionState, user: SessionUser) {
  await getHostOrThrow(id, user);
  return prisma.host.update({ where: { id }, data: { connectionState: state } });
}
