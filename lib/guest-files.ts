import { isIpv4 } from "@/lib/create-ip";

export const GUEST_FILE_MAX_BYTES = 8 * 1024 * 1024;
export const GUEST_FILE_MAX_PATH = 4096;

export type GuestFileKind = "file" | "dir" | "other";

export type GuestFileEntry = {
  name: string;
  path: string;
  type: GuestFileKind;
  size: number;
  mtime: number | null;
};

const TEXT_EXT =
  /\.(txt|md|json|ya?ml|xml|conf|cfg|ini|env|sh|bash|zsh|py|js|mjs|cjs|ts|tsx|jsx|css|html|htm|log|service|timer|list|toml|php|rb|go|rs|c|h|cc|cpp|hpp|sql|csv|properties|desktop|policy|rules)$/i;

export function resolveGuestPath(cwd: string, name?: string): string {
  const joined = name
    ? name.startsWith("/")
      ? name
      : `${String(cwd || "/").replace(/\/+$/, "") || ""}/${name}`
    : cwd || "/";
  if (joined.includes("\0")) {
    throw new Error("Invalid path");
  }
  const parts: string[] = [];
  for (const seg of joined.replace(/\\/g, "/").split("/")) {
    if (!seg || seg === ".") continue;
    if (seg === "..") {
      if (!parts.length) throw new Error("Invalid path");
      parts.pop();
      continue;
    }
    parts.push(seg);
  }
  const path = `/${parts.join("/")}`;
  if (path.length > GUEST_FILE_MAX_PATH) throw new Error("Path too long");
  return path;
}

export function guestPathParent(path: string): string | null {
  const resolved = resolveGuestPath(path);
  if (resolved === "/") return null;
  const idx = resolved.lastIndexOf("/");
  return idx <= 0 ? "/" : resolved.slice(0, idx);
}

export function guestFileName(path: string): string {
  const resolved = resolveGuestPath(path);
  if (resolved === "/") return "/";
  return resolved.slice(resolved.lastIndexOf("/") + 1);
}

export function isAllowedSftpTarget(host: string): string {
  const raw = host.trim();
  if (!raw || raw.length > 253) throw new Error("Invalid SSH host");
  if (isIpv4(raw)) {
    const [a, b, c, d] = raw.split(".").map((n) => Number(n));
    if (a === 0 || a === 127 || a >= 224) throw new Error("Invalid SSH host");
    if (a === 169 && b === 254 && c === 169 && d === 254) throw new Error("Invalid SSH host");
    return raw;
  }
  if (raw.includes(":")) {
    const ip = raw.replace(/^\[/, "").replace(/\]$/, "").toLowerCase();
    if (ip === "::" || ip === "::1" || ip.startsWith("fe80:")) throw new Error("Invalid SSH host");
    if (!/^[0-9a-f:]+$/.test(ip)) throw new Error("Invalid SSH host");
    return ip;
  }
  throw new Error("Invalid SSH host");
}

export function clampSftpPort(port: unknown): number {
  const n = typeof port === "number" ? port : Number(port ?? 22);
  if (!Number.isInteger(n) || n < 1 || n > 65535) throw new Error("Invalid SSH port");
  return n;
}

export function isProbablyTextFile(name: string, bytes?: Uint8Array): boolean {
  if (TEXT_EXT.test(name)) return true;
  if (!bytes || bytes.length === 0) return name.endsWith(".txt") || !name.includes(".");
  if (bytes.length > 256 * 1024) return false;
  const sample = bytes.subarray(0, Math.min(bytes.length, 800));
  if (sample.includes(0)) return false;
  let odd = 0;
  for (const b of sample) {
    if (b < 9 || (b > 13 && b < 32)) odd += 1;
  }
  return odd / sample.length < 0.08;
}

export function decodeGuestFileContent(base64: string, max = GUEST_FILE_MAX_BYTES): Buffer {
  const compact = base64.replace(/\s+/g, "");
  if (!compact) return Buffer.alloc(0);
  const buf = Buffer.from(compact, "base64");
  if (buf.length > max) throw new Error("File too large");
  return buf;
}
