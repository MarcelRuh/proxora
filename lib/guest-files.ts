import { isIpv4 } from "@/lib/create-ip";

export const GUEST_FILE_MAX_BYTES = 8 * 1024 * 1024;
/** Streamed SFTP download (not the JSON editor). 4 GiB files must fit. */
export const GUEST_FILE_STREAM_MAX_BYTES = 16 * 1024 * 1024 * 1024;
export const GUEST_FILE_MAX_PATH = 4096;

export type GuestFileKind = "file" | "dir" | "other";

export type GuestFileEntry = {
  name: string;
  path: string;
  type: GuestFileKind;
  size: number;
  mtime: number | null;
};

export type GuestFileOp = "list" | "read" | "write" | "mkdir" | "delete";

export type GuestFileRequest = {
  kind: "vm" | "lxc";
  node?: string;
  vmid: number;
  op: GuestFileOp;
  via?: "agent" | "sftp";
  target?: string;
  port?: number;
  username?: string;
  password?: string;
  path: string;
  contentBase64?: string;
};

export type GuestFileResult = {
  path: string;
  via?: "agent" | "sftp";
  entries?: GuestFileEntry[];
  name?: string;
  size?: number;
  contentBase64?: string;
  fingerprint?: string;
  ticket?: string;
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

export function attachmentDisposition(name: string): string {
  const fallback =
    name.replace(/[^\x20-\x7E]+/g, "_").replace(/["\\;\r\n]/g, "_").slice(0, 150).trim() || "download";
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(name)}`;
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

export const AGENT_FILE_MAX_BYTES = 48 * 1024;

export const GUEST_FILE_SHORTCUTS = ["/", "/root", "/home", "/etc", "/var", "/tmp", "/opt", "/usr"];

export function guestPathCrumbs(path: string): Array<{ name: string; path: string }> {
  const resolved = resolveGuestPath(path);
  const crumbs: Array<{ name: string; path: string }> = [{ name: "/", path: "/" }];
  if (resolved === "/") return crumbs;
  const parts = resolved.split("/").filter(Boolean);
  let acc = "";
  for (const part of parts) {
    acc += `/${part}`;
    crumbs.push({ name: part, path: acc });
  }
  return crumbs;
}

export function parseGuestListOutput(text: string, dir: string): GuestFileEntry[] {
  const entries: GuestFileEntry[] = [];
  const seen = new Set<string>();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\r$/, "");
    if (!line) continue;
    let entry: GuestFileEntry | null = null;
    const tab = line.split("\t");
    if (tab.length >= 4 && tab[0] && tab[0].length === 1) {
      const kindChar = tab[0];
      const size = Number(tab[1] ?? 0);
      const mtime = Number(tab[2] ?? 0);
      const name = tab.slice(3).join("\t");
      if (!name || name === "." || name === "..") continue;
      entry = {
        name,
        path: resolveGuestPath(dir, name),
        type: kindChar === "d" ? "dir" : kindChar === "f" || kindChar === "l" ? "file" : "other",
        size: Number.isFinite(size) ? size : 0,
        mtime: Number.isFinite(mtime) && mtime > 0 ? Math.round(mtime * 1000) : null,
      };
    } else {
      let name = line;
      let type: GuestFileKind = "file";
      if (name.endsWith("/")) {
        type = "dir";
        name = name.slice(0, -1);
      } else if (name.endsWith("@") || name.endsWith("|") || name.endsWith("=")) {
        type = "other";
        name = name.slice(0, -1);
      } else if (name.endsWith("*")) {
        name = name.slice(0, -1);
      }
      if (!name || name === "." || name === "..") continue;
      entry = { name, path: resolveGuestPath(dir, name), type, size: 0, mtime: null };
    }
    if (!entry || seen.has(entry.name)) continue;
    seen.add(entry.name);
    entries.push(entry);
  }
  entries.sort((a, b) => {
    if (a.type === "dir" && b.type !== "dir") return -1;
    if (a.type !== "dir" && b.type === "dir") return 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });
  return entries;
}
