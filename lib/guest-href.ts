export function guestDetailHref(kind: "vm" | "lxc", hostId: string, node: string, vmid: number): string {
  const base = kind === "lxc" ? "containers" : "vms";
  return `/${base}/${hostId}/${encodeURIComponent(node)}/${vmid}`;
}

export function canOpenGuestDetail(hostId: string, node: string, vmid: number): boolean {
  return Boolean(hostId && node && Number.isFinite(vmid) && vmid > 0);
}

/** Full document navigation — App Router replace is unreliable while a Radix dialog is open. */
export function visitGuestDetail(kind: "vm" | "lxc", hostId: string, node: string, vmid: number): boolean {
  if (typeof window === "undefined" || !canOpenGuestDetail(hostId, node, vmid)) return false;
  window.location.href = guestDetailHref(kind, hostId, node, vmid);
  return true;
}
