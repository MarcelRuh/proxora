import type { MessageKey } from "@/lib/i18n/messages";

type Translate = (key: MessageKey, vars?: Record<string, string | number>) => string;

const EXACT: Record<string, MessageKey> = {
  "Unable to connect": "dashboard.unableToConnect",
  "Host did not respond in time": "dashboard.hostTimeout",
  "Connection failed": "hosts.connectionFailed",
  "Proxora update in progress": "hosts.peerUpdating",
  "Peer did not return after Proxora update": "hosts.peerMissing",
};

function knownHostError(message: string): MessageKey | null {
  const text = message.toLowerCase();
  if (text.includes("timed out") || text.includes("timeout") || text.includes("aborted")) return "dashboard.hostTimeout";
  if (text.includes("permission check failed") || text.includes("permission denied")) return "hosts.proxmoxForbidden";
  if (text.includes("authentication failure") || text.includes("authentication failed") || text.includes("invalid token")) {
    return "hosts.proxmoxAuth";
  }
  if (
    text.includes("certificate") ||
    text.includes("altnames") ||
    text.includes("self-signed") ||
    text.includes("self signed") ||
    text.includes("unable to verify")
  ) {
    return "hosts.proxmoxTls";
  }
  if (text.startsWith("invalid json from peer") || text.startsWith("peer proxora error")) return "hosts.peerUnreadable";
  if (
    text.startsWith("unable to connect") ||
    text.startsWith("connection failed") ||
    text.includes("econnrefused") ||
    text.includes("enotfound") ||
    text.includes("ehostunreach") ||
    text.includes("econnreset") ||
    text.includes("eai_again") ||
    text.includes("network is unreachable") ||
    text.includes("no route to host")
  ) {
    return "dashboard.unableToConnect";
  }
  return null;
}

export function hostErrorText(message: string | null | undefined, t: Translate): string | null {
  if (!message) return null;
  const exact = EXACT[message];
  if (exact) return t(exact);
  const known = knownHostError(message);
  return known ? t(known) : message;
}
