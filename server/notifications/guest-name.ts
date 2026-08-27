export function pickGuestName(record: Record<string, unknown> | null | undefined): string | undefined {
  if (!record) return undefined;
  const name = String(record.name ?? record.hostname ?? "").trim();
  return name || undefined;
}

type GuestLookupClient = {
  vms: { status: (node: string, vmid: number) => Promise<Record<string, unknown>> };
  lxc: { status: (node: string, vmid: number) => Promise<Record<string, unknown>> };
};

export async function lookupGuestName(
  client: GuestLookupClient,
  node: string,
  vmid: number,
): Promise<string | undefined> {
  if (!Number.isFinite(vmid) || vmid <= 0 || !node) return undefined;
  const qemu = await client.vms.status(node, vmid).catch(() => null);
  const fromVm = pickGuestName(qemu);
  if (fromVm) return fromVm;
  const lxc = await client.lxc.status(node, vmid).catch(() => null);
  return pickGuestName(lxc);
}
