import type { ProxmoxClient } from "@/server/proxmox/client";
import { collectStorageVolumes } from "@/server/services/storage-content";

export async function collectVztmplVolumes(client: ProxmoxClient, nodes: string[]) {
  return collectStorageVolumes(client, nodes, "vztmpl");
}

export async function collectIsoVolumes(client: ProxmoxClient, nodes: string[]) {
  return collectStorageVolumes(client, nodes, "iso");
}
