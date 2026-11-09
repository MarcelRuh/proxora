import { compareSemver } from "@/lib/version";

export const PROXORA_DESKTOP_UA = "ProxoraDesktop";

export function parseProxoraDesktopVersion(ua: string): string | null {
  const match = /ProxoraDesktop\/(\d+\.\d+\.\d+)/i.exec(ua);
  return match?.[1] ?? null;
}

export function desktopUpdateAvailable(current: string, latest: string | null | undefined): boolean {
  if (!current || !latest) return false;
  return compareSemver(latest, current) > 0;
}
