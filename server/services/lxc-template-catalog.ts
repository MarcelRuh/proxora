import type { ProxmoxClient } from "@/server/proxmox/client";
import { isVztmplRow, storageContentVolid } from "@/lib/lxc-templates";

export async function collectVztmplVolumes(
  client: ProxmoxClient,
  nodes: string[],
): Promise<{ storages: string[]; volids: string[] }> {
  const storages = new Set<string>();
  const seen = new Set<string>();
  const volids: string[] = [];
  await Promise.all(
    nodes.map(async (node) => {
      const list = await client.storage.list(node).catch(() => []);
      const tmpl = list.filter((s) => (s.content ?? "").includes("vztmpl"));
      for (const s of tmpl) storages.add(s.storage);
      await Promise.all(
        tmpl.map(async (s) => {
          let rows = await client.storage.content(node, s.storage, "vztmpl").catch(() => []);
          if (!rows.length) {
            rows = (await client.storage.content(node, s.storage).catch(() => [])).filter((row) =>
              isVztmplRow(row as Record<string, unknown>),
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
