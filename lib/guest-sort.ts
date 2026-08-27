import { guestCpuPercent } from "@/lib/utils";

export type GuestSortKey = "vmid" | "name" | "kind" | "host" | "status" | "cpu" | "ram" | "disk" | "uptime";
export type GuestSortDir = "asc" | "desc";
export type GuestSort = { key: GuestSortKey; dir: GuestSortDir };

export const DEFAULT_GUEST_SORT: GuestSort = { key: "vmid", dir: "asc" };

type SortableGuest = {
  vmid: number;
  name: string;
  node: string;
  status: string;
  cpu: number;
  cpus: number;
  mem: number;
  maxmem: number;
  disk: number;
  maxdisk: number;
  uptime: number;
  hostName?: string;
  kind?: "vm" | "lxc";
};

export function guestSortValue(guest: SortableGuest, key: GuestSortKey): string | number {
  switch (key) {
    case "vmid":
      return guest.vmid;
    case "name":
      return guest.name.toLowerCase();
    case "kind":
      return guest.kind ?? "";
    case "host":
      return `${guest.hostName ?? ""}/${guest.node}`.toLowerCase();
    case "status":
      return guest.status;
    case "cpu":
      return guestCpuPercent(guest.cpu, guest.cpus);
    case "ram":
      return guest.maxmem ? guest.mem / guest.maxmem : 0;
    case "disk":
      return guest.maxdisk ? guest.disk / guest.maxdisk : 0;
    case "uptime":
      return guest.uptime || 0;
  }
}

export function nextGuestSort(current: GuestSort, key: GuestSortKey): GuestSort {
  if (current.key === key) {
    return { key, dir: current.dir === "asc" ? "desc" : "asc" };
  }
  const descFirst = key === "cpu" || key === "ram" || key === "disk" || key === "uptime";
  return { key, dir: descFirst ? "desc" : "asc" };
}

export function compareGuests(a: SortableGuest, b: SortableGuest, sort: GuestSort): number {
  const va = guestSortValue(a, sort.key);
  const vb = guestSortValue(b, sort.key);
  const cmp = typeof va === "string" ? va.localeCompare(String(vb), "de") : va - Number(vb);
  if (cmp !== 0) return sort.dir === "asc" ? cmp : -cmp;
  return a.vmid - b.vmid;
}

export function sortGuests<T extends SortableGuest>(items: T[], sort: GuestSort): T[] {
  return [...items].sort((a, b) => compareGuests(a, b, sort));
}
