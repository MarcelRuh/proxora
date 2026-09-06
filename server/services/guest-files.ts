import { Client, type SFTPWrapper } from "ssh2";
import { HostOrigin, type Host } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ForbiddenError, HostUnreachableError, ValidationError } from "@/lib/errors";
import {
  GUEST_FILE_MAX_BYTES,
  clampSftpPort,
  decodeGuestFileContent,
  guestFileName,
  isAllowedSftpTarget,
  resolveGuestPath,
  type GuestFileEntry,
  type GuestFileKind,
  type GuestFileOp,
  type GuestFileRequest,
  type GuestFileResult,
} from "@/lib/guest-files";
import { shareHasPermission, type ShareLevel } from "@/lib/federation-access";
import { outboundToken, peerHttpBase } from "@/server/services/wireguard-service";
import { clientForHost } from "@/server/services/host-service";
import { guestAgentFiles } from "@/server/services/guest-agent-files";

export type { GuestFileOp, GuestFileRequest, GuestFileResult };

const CONNECT_MS = 12_000;
const OP_MS = 45_000;

function fileError(error: unknown, fallback: string): Error {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();
  if (lower.includes("authentication") || lower.includes("auth") || lower.includes("permission denied")) {
    return new ValidationError("SSH-Login fehlgeschlagen");
  }
  if (lower.includes("timed out") || lower.includes("timeout") || lower.includes("etimedout")) {
    return new ValidationError("SSH-Zeitüberschreitung — Gast erreichbar? SSH aktiv?");
  }
  if (lower.includes("econnrefused") || lower.includes("connect")) {
    return new ValidationError("SSH nicht erreichbar (Port, Firewall, Dienst)");
  }
  if (error instanceof ValidationError) return error;
  return new ValidationError(message.trim().slice(0, 240) || fallback);
}

function modeType(mode: number | undefined): GuestFileKind {
  const type = (mode ?? 0) & 0o170000;
  if (type === 0o040000) return "dir";
  if (type === 0o100000) return "file";
  return "other";
}

function withTimeout<T>(ms: number, work: Promise<T>, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new ValidationError(label)), ms);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function withSftp<T>(
  target: string,
  port: number,
  username: string,
  password: string,
  fn: (sftp: SFTPWrapper, fingerprint: string) => Promise<T>,
): Promise<T> {
  const host = isAllowedSftpTarget(target);
  const user = username.trim();
  if (!user || user.length > 64) throw new ValidationError("SSH-Benutzer fehlt");
  if (!password || password.length > 512) throw new ValidationError("SSH-Passwort fehlt");

  return new Promise((resolve, reject) => {
    const client = new Client();
    let fingerprint = "";
    let settled = false;
    const finish = (error?: unknown, value?: T) => {
      if (settled) return;
      settled = true;
      try {
        client.end();
      } catch {
        /* ignore */
      }
      if (error) reject(fileError(error, "SSH fehlgeschlagen"));
      else resolve(value as T);
    };

    const timer = setTimeout(() => finish(new ValidationError("SSH-Zeitüberschreitung — Gast erreichbar? SSH aktiv?")), CONNECT_MS + 2_000);

    client.on("keyboard-interactive", (_name, _instr, _lang, prompts, done) => {
      done(prompts.map(() => password));
    });
    client.on("ready", () => {
      client.sftp((err, sftp) => {
        if (err || !sftp) {
          clearTimeout(timer);
          finish(err ?? new ValidationError("SFTP nicht verfügbar"));
          return;
        }
        withTimeout(OP_MS, fn(sftp, fingerprint), "SSH-Zeitüberschreitung").then(
          (value) => {
            clearTimeout(timer);
            finish(undefined, value);
          },
          (error) => {
            clearTimeout(timer);
            finish(error);
          },
        );
      });
    });
    client.on("error", (error) => {
      clearTimeout(timer);
      finish(error);
    });
    client.connect({
      host,
      port,
      username: user,
      password,
      readyTimeout: CONNECT_MS,
      tryKeyboard: true,
      hostVerifier: (key: Buffer) => {
        fingerprint = Buffer.isBuffer(key) ? key.toString("hex").slice(0, 32) : String(key).slice(0, 32);
        return true;
      },
    });
  });
}

async function listDir(sftp: SFTPWrapper, path: string): Promise<GuestFileEntry[]> {
  const listing = await new Promise<Array<{ filename: string; attrs?: { size?: number; mtime?: number; mode?: number } }>>(
    (resolve, reject) => {
      sftp.readdir(path, (err, list) => {
        if (err) reject(err);
        else resolve(list ?? []);
      });
    },
  );
  const entries: GuestFileEntry[] = [];
  for (const item of listing) {
    const name = item.filename;
    if (!name || name === "." || name === "..") continue;
    const child = resolveGuestPath(path, name);
    entries.push({
      name,
      path: child,
      type: modeType(item.attrs?.mode),
      size: Number(item.attrs?.size ?? 0),
      mtime: item.attrs?.mtime ? item.attrs.mtime * 1000 : null,
    });
  }
  entries.sort((a, b) => {
    if (a.type === "dir" && b.type !== "dir") return -1;
    if (a.type !== "dir" && b.type === "dir") return 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });
  return entries;
}

async function readFile(sftp: SFTPWrapper, path: string): Promise<Buffer> {
  const stat = await new Promise<{ size: number; mode: number }>((resolve, reject) => {
    sftp.stat(path, (err, attrs) => {
      if (err) reject(err);
      else resolve({ size: Number(attrs.size ?? 0), mode: Number(attrs.mode ?? 0) });
    });
  });
  if (modeType(stat.mode) === "dir") throw new ValidationError("Ist ein Ordner");
  if (stat.size > GUEST_FILE_MAX_BYTES) {
    throw new ValidationError(`Datei größer als ${Math.round(GUEST_FILE_MAX_BYTES / (1024 * 1024))} MB`);
  }
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    const stream = sftp.createReadStream(path);
    stream.on("data", (chunk: Buffer | string) => {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += buf.length;
      if (total > GUEST_FILE_MAX_BYTES) {
        stream.destroy();
        reject(new ValidationError(`Datei größer als ${Math.round(GUEST_FILE_MAX_BYTES / (1024 * 1024))} MB`));
        return;
      }
      chunks.push(buf);
    });
    stream.on("error", reject);
    stream.on("end", () => resolve(Buffer.concat(chunks)));
  });
}

async function writeFile(sftp: SFTPWrapper, path: string, body: Buffer): Promise<void> {
  if (body.length > GUEST_FILE_MAX_BYTES) {
    throw new ValidationError(`Datei größer als ${Math.round(GUEST_FILE_MAX_BYTES / (1024 * 1024))} MB`);
  }
  await new Promise<void>((resolve, reject) => {
    const stream = sftp.createWriteStream(path, { flags: "w", mode: 0o644 });
    stream.on("error", reject);
    stream.on("close", () => resolve());
    stream.end(body);
  });
}

async function mkdir(sftp: SFTPWrapper, path: string): Promise<void> {
  if (path === "/") throw new ValidationError("Ungültiger Ordner");
  await new Promise<void>((resolve, reject) => {
    sftp.mkdir(path, { mode: 0o755 }, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

async function remove(sftp: SFTPWrapper, path: string): Promise<void> {
  if (path === "/") throw new ValidationError("Root lässt sich nicht löschen");
  const stat = await new Promise<{ mode: number }>((resolve, reject) => {
    sftp.stat(path, (err, attrs) => {
      if (err) reject(err);
      else resolve({ mode: Number(attrs.mode ?? 0) });
    });
  });
  await new Promise<void>((resolve, reject) => {
    const done = (err?: Error | null) => (err ? reject(err) : resolve());
    if (modeType(stat.mode) === "dir") sftp.rmdir(path, done);
    else sftp.unlink(path, done);
  });
}

export async function guestSftp(input: GuestFileRequest): Promise<GuestFileResult> {
  let path: string;
  let port: number;
  try {
    path = resolveGuestPath(input.path || "/");
    port = clampSftpPort(input.port ?? 22);
  } catch (error) {
    throw new ValidationError(error instanceof Error ? error.message : "Invalid path");
  }
  const target = input.target?.trim() ?? "";
  const username = input.username?.trim() ?? "";
  const password = input.password ?? "";
  if (!target || !username || !password) {
    throw new ValidationError("SSH-Zugangsdaten fehlen");
  }
  return withSftp(target, port, username, password, async (sftp, fingerprint) => {
    switch (input.op) {
      case "list": {
        const entries = await listDir(sftp, path);
        return { path, via: "sftp", entries, fingerprint };
      }
      case "read": {
        const buf = await readFile(sftp, path);
        return {
          path,
          via: "sftp",
          name: guestFileName(path),
          size: buf.length,
          contentBase64: buf.toString("base64"),
          fingerprint,
        };
      }
      case "write": {
        const buf = decodeGuestFileContent(input.contentBase64 ?? "");
        await writeFile(sftp, path, buf);
        return { path, via: "sftp", name: guestFileName(path), size: buf.length, fingerprint };
      }
      case "mkdir": {
        await mkdir(sftp, path);
        return { path, via: "sftp", fingerprint };
      }
      case "delete": {
        await remove(sftp, path);
        return { path, via: "sftp", fingerprint };
      }
      default:
        throw new ValidationError("Unknown file operation");
    }
  });
}

async function proxyGuestFilesToPeer(host: Host, input: GuestFileRequest): Promise<GuestFileResult> {
  if (!host.peerId || !host.remoteHostId) throw new ValidationError("Peer host is incomplete");
  const peer = await prisma.wireguardPeer.findUnique({ where: { id: host.peerId } });
  if (!peer?.address) throw new HostUnreachableError(host.name, "Set the colleague's Proxora IP first");
  const url = `${peerHttpBase(peer)}/api/federation/guest-files`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${outboundToken(peer)}`,
    },
    body: JSON.stringify({
      remoteHostId: host.remoteHostId,
      ...input,
    }),
    signal: AbortSignal.timeout(60_000),
  });
  const json = (await response.json().catch(() => ({}))) as GuestFileResult & { error?: string };
  if (!response.ok) {
    throw new ValidationError(json.error || `Peer Proxora error (${response.status})`);
  }
  return json;
}

export async function runGuestFileOp(host: Host, input: GuestFileRequest): Promise<GuestFileResult> {
  const viaAgent = input.kind === "vm" && input.via !== "sftp" && !input.password;
  if (viaAgent) {
    const client = await clientForHost(host);
    return guestAgentFiles(client, input);
  }
  if (host.origin === HostOrigin.PEER) return proxyGuestFilesToPeer(host, input);
  try {
    return await guestSftp(input);
  } catch (error) {
    if (error instanceof ValidationError || error instanceof ForbiddenError) throw error;
    throw fileError(error, "SSH fehlgeschlagen");
  }
}

export function shareAllowsGuestFiles(
  level: ShareLevel,
  permissions: readonly string[] | null | undefined,
  kind: "vm" | "lxc",
): boolean {
  return shareHasPermission(level, permissions, kind === "vm" ? "vm.files" : "lxc.files");
}
