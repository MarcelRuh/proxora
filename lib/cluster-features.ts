export function hostShowsClusterUi(isClusterMember: boolean | null | undefined): boolean {
  return isClusterMember === true;
}

export function haSid(kind: "vm" | "lxc", vmid: number): string {
  return `${kind === "lxc" ? "ct" : "vm"}:${vmid}`;
}

export function parseHaSid(sid: string): { kind: "vm" | "lxc"; vmid: number } | null {
  const m = /^(vm|ct):(\d+)$/.exec(sid.trim());
  if (!m) return null;
  return { kind: m[1] === "ct" ? "lxc" : "vm", vmid: Number(m[2]) };
}
