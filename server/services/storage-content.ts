import type { ProxmoxClient } from "@/server/proxmox/client";
import { isIsoRow } from "@/lib/iso-images";
import { isVztmplRow, storageContentVolid } from "@/lib/lxc-templates";

export async function collectStorageVolumes(
  client: ProxmoxClient,
  nodes: string[],
  content: "vztmpl" | "iso",
): Promise<{ storages: string[]; volids: string[] }> {
  const match = content === "iso" ? isIsoRow : isVztmplRow;
  const storages = new Set<string>();
  const seen = new Set<string>();
  const volids: string[] = [];
  await Promise.all(
    nodes.map(async (node) => {
      const list = await client.storage.list(node).catch(() => []);
      const eligible = list.filter((s) => (s.content ?? "").includes(content));
      for (const s of eligible) storages.add(s.storage);
      await Promise.all(
        eligible.map(async (s) => {
          let rows = await client.storage.content(node, s.storage, content).catch(() => []);
          if (!rows.length) {
            rows = (await client.storage.content(node, s.storage).catch(() => [])).filter((row) =>
              match(row as Record<string, unknown>),
            );
          }
          for (const row of rows) {
            const volid = storageContentVolid(row as Record<string, unknown>);
            if (!volid || seen.has(volid)) continue;
            seen.add(volid);
            volids.push(volid);
          }
        }),
      );
    }),
  );
  return { storages: [...storages], volids };
}
