import type { Host } from "@prisma/client";
import type { ProxmoxClient } from "@/server/proxmox/client";

export type HostClientKey = Pick<
  Host,
  "id" | "url" | "authType" | "username" | "tokenId" | "allowInsecureTls" | "encryptedSecret"
>;

export function hostClientFingerprint(host: HostClientKey): string {
  return [
    host.url,
    host.authType,
    host.username,
    host.tokenId ?? "",
    host.allowInsecureTls ? "1" : "0",
    host.encryptedSecret,
  ].join("\0");
}

export class HostClientCache {
  private readonly clients = new Map<string, { fingerprint: string; client: ProxmoxClient }>();

  get(host: HostClientKey, create: (host: HostClientKey) => ProxmoxClient): ProxmoxClient {
    const fingerprint = hostClientFingerprint(host);
    const hit = this.clients.get(host.id);
    if (hit && hit.fingerprint === fingerprint) return hit.client;
    hit?.client.dispose();
    const client = create(host);
    this.clients.set(host.id, { fingerprint, client });
    return client;
  }

  invalidate(hostId: string): void {
    const hit = this.clients.get(hostId);
    hit?.client.dispose();
    this.clients.delete(hostId);
  }
}

export const hostClientCache = new HostClientCache();
