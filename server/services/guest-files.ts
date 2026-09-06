import { Readable, Transform } from "node:stream";
import { Client, type SFTPWrapper } from "ssh2";
import { HostOrigin, type Host } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ForbiddenError, HostUnreachableError, ValidationError } from "@/lib/errors";
import {
  GUEST_FILE_MAX_BYTES,
  GUEST_FILE_STREAM_MAX_BYTES,
  attachmentDisposition,
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

function limitSftpBytes(source: NodeJS.ReadableStream, max: number): Transform {
  let total = 0;
  const limiter = new Transform({
    highWaterMark: 512 * 1024,
    transform(chunk, _enc, cb) {
      total += (chunk as Buffer).length;
      if (total > max) {
        cb(new ValidationError(`Datei größer als ${Math.round(max / (1024 * 1024 * 1024))} GB`));
        return;
      }
      cb(null, chunk);
    },
  });
  source.on("error", (err) => limiter.destroy(err as Error));
  source.pipe(limiter);
  return limiter;
}

/** Stream a guest file over SFTP. SSH stays open until the HTTP body ends. */
export async function sftpDownloadResponse(input: {
  target: string;
  port?: number;
  username: string;
  password: string;
  path: string;
}): Promise<Response> {
  let path: string;
  let port: number;
  let host: string;
  try {
    path = resolveGuestPath(input.path || "/");
    port = clampSftpPort(input.port ?? 22);
    host = isAllowedSftpTarget(input.target);
  } catch (error) {
    throw new ValidationError(error instanceof Error ? error.message : "Invalid path");
  }
  const user = input.username.trim();
  const password = input.password;
  if (!user || user.length > 64) throw new ValidationError("SSH-Benutzer fehlt");
  if (!password || password.length > 512) throw new ValidationError("SSH-Passwort fehlt");

  return new Promise((resolve, reject) => {
    const client = new Client();
    let settled = false;
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      try {
        client.end();
      } catch {
        /* ignore */
      }
      reject(fileError(error, "SSH fehlgeschlagen"));
    };
    const timer = setTimeout(
      () => fail(new ValidationError("SSH-Zeitüberschreitung — Gast erreichbar? SSH aktiv?")),
      CONNECT_MS + 2_000,
    );

    client.on("keyboard-interactive", (_name, _instr, _lang, prompts, done) => {
      done(prompts.map(() => password));
    });
    client.on("ready", () => {
      client.sftp((err, sftp) => {
        if (err || !sftp) {
          clearTimeout(timer);
          fail(err ?? new ValidationError("SFTP nicht verfügbar"));
          return;
        }
        sftp.stat(path, (statErr, attrs) => {
          if (statErr) {
            clearTimeout(timer);
            fail(statErr);
            return;
          }
          if (modeType(Number(attrs.mode ?? 0)) === "dir") {
            clearTimeout(timer);
            fail(new ValidationError("Ist ein Ordner"));
            return;
          }
          const size = Number(attrs.size ?? 0);
          if (Number.isFinite(size) && size > GUEST_FILE_STREAM_MAX_BYTES) {
            clearTimeout(timer);
            fail(new ValidationError(`Datei größer als ${Math.round(GUEST_FILE_STREAM_MAX_BYTES / (1024 * 1024 * 1024))} GB`));
            return;
          }
          clearTimeout(timer);
          const nodeStream = sftp.createReadStream(path, { highWaterMark: 512 * 1024 });
          const limited = limitSftpBytes(nodeStream, GUEST_FILE_STREAM_MAX_BYTES);
          const endClient = () => {
            try {
              client.end();
            } catch {
              /* ignore */
            }
          };
          limited.on("close", endClient);
          limited.on("error", endClient);
          const web = Readable.toWeb(limited) as unknown as ReadableStream<Uint8Array>;
          const headers = new Headers();
          headers.set("Content-Type", "application/octet-stream");
          headers.set("Content-Disposition", attachmentDisposition(guestFileName(path)));
          headers.set("Cache-Control", "no-store");
          if (Number.isFinite(size) && size > 0) {
            headers.set("Content-Length", String(size));
          }
          settled = true;
          resolve(new Response(web, { status: 200, headers }));
        });
      });
    });
    client.on("error", (error) => {
      clearTimeout(timer);
      fail(error);
    });
    client.connect({
      host,
      port,
      username: user,
      password,
      readyTimeout: CONNECT_MS,
      tryKeyboard: true,
      hostVerifier: () => true,
    });
  });
}

async function proxyGuestFileDownloadToPeer(
  host: Host,
  input: { target: string; port: number; username: string; password: string; path: string; kind: "vm" | "lxc"; vmid: number },
): Promise<Response> {
  if (!host.peerId || !host.remoteHostId) throw new ValidationError("Peer host is incomplete");
  const peer = await prisma.wireguardPeer.findUnique({ where: { id: host.peerId } });
  if (!peer?.address) throw new HostUnreachableError(host.name, "Set the colleague's Proxora IP first");
  const url = `${peerHttpBase(peer)}/api/federation/guest-files/download`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Accept: "application/octet-stream",
      "Content-Type": "application/json",
      Authorization: `Bearer ${outboundToken(peer)}`,
    },
    body: JSON.stringify({
      remoteHostId: host.remoteHostId,
      kind: input.kind,
      vmid: input.vmid,
      target: input.target,
      port: input.port,
      username: input.username,
      password: input.password,
      path: input.path,
    }),
  });
  if (!response.ok || !response.body) {
    const json = (await response.json().catch(() => ({}))) as { error?: string };
    throw new ValidationError(json.error || `Peer Proxora error (${response.status})`);
  }
  const headers = new Headers();
  const type = response.headers.get("content-type");
  headers.set("Content-Type", type || "application/octet-stream");
  const disposition = response.headers.get("content-disposition");
  if (disposition) headers.set("Content-Disposition", disposition);
  const length = response.headers.get("content-length");
  if (length) headers.set("Content-Length", length);
  headers.set("Cache-Control", "no-store");
  return new Response(response.body, { status: 200, headers });
}

export async function streamGuestFileDownload(
  host: Host,
  input: {
    kind: "vm" | "lxc";
    vmid: number;
    target: string;
    port: number;
    username: string;
    password: string;
    path: string;
  },
): Promise<Response> {
  if (host.origin === HostOrigin.PEER) return proxyGuestFileDownloadToPeer(host, input);
  try {
    return await sftpDownloadResponse(input);
  } catch (error) {
    if (error instanceof ValidationError || error instanceof ForbiddenError) throw error;
    throw fileError(error, "SSH fehlgeschlagen");
  }
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
