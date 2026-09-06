import { PassThrough, Readable, Transform } from "node:stream";
import { Client, type SFTPWrapper } from "ssh2";
import { HostOrigin, type Host } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ForbiddenError, HostUnreachableError, ValidationError } from "@/lib/errors";
import {
  GUEST_FILE_MAX_BYTES,
  attachmentDisposition,
  clampSftpPort,
  decodeGuestFileContent,
  guestFileName,
  guestPathParent,
  hasGuestSshAuth,
  isAllowedSftpTarget,
  looksLikeSshPrivateKey,
  resolveGuestPath,
  shSingleQuote,
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
import {
  encodeGuestTransferMeta,
  GUEST_TRANSFER_META_HEADER,
} from "@/server/services/guest-file-tickets";

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

type SshAuth = {
  target: string;
  port: number;
  username: string;
  password?: string;
  privateKey?: string;
  passphrase?: string;
};

function parseSshAuth(input: {
  target?: string;
  port?: number;
  username?: string;
  password?: string;
  privateKey?: string;
  passphrase?: string;
}): SshAuth {
  const target = input.target?.trim() ?? "";
  const username = input.username?.trim() ?? "";
  const password = input.password ?? "";
  const privateKey = input.privateKey?.trim() ?? "";
  const passphrase = input.passphrase ?? "";
  let port: number;
  try {
    port = clampSftpPort(input.port ?? 22);
    isAllowedSftpTarget(target);
  } catch (error) {
    throw new ValidationError(error instanceof Error ? error.message : "Invalid SSH host");
  }
  if (!username || username.length > 64) throw new ValidationError("SSH-Benutzer fehlt");
  if (!hasGuestSshAuth({ password, privateKey })) {
    throw new ValidationError("SSH-Passwort oder Schlüssel fehlt");
  }
  if (privateKey && !looksLikeSshPrivateKey(privateKey)) {
    throw new ValidationError("Ungültiger SSH-Schlüssel");
  }
  return {
    target,
    port,
    username,
    password: password || undefined,
    privateKey: privateKey || undefined,
    passphrase: passphrase || undefined,
  };
}

async function openSftp(auth: SshAuth): Promise<{ client: Client; sftp: SFTPWrapper; fingerprint: string }> {
  const host = isAllowedSftpTarget(auth.target);
  const password = auth.password ?? "";
  const privateKey = auth.privateKey ?? "";

  return new Promise((resolve, reject) => {
    const client = new Client();
    let fingerprint = "";
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

    if (password) {
      client.on("keyboard-interactive", (_name, _instr, _lang, prompts, done) => {
        done(prompts.map(() => password));
      });
    }
    client.on("ready", () => {
      client.sftp((err, sftp) => {
        if (err || !sftp) {
          clearTimeout(timer);
          fail(err ?? new ValidationError("SFTP nicht verfügbar"));
          return;
        }
        clearTimeout(timer);
        settled = true;
        resolve({ client, sftp, fingerprint });
      });
    });
    client.on("error", (error) => {
      clearTimeout(timer);
      fail(error);
    });
    client.connect({
      host,
      port: auth.port,
      username: auth.username,
      readyTimeout: CONNECT_MS,
      tryKeyboard: Boolean(password),
      algorithms: { compress: ["none"] },
      ...(password ? { password } : {}),
      ...(privateKey ? { privateKey, passphrase: auth.passphrase || undefined } : {}),
      hostVerifier: (key: Buffer) => {
        fingerprint = Buffer.isBuffer(key) ? key.toString("hex").slice(0, 32) : String(key).slice(0, 32);
        return true;
      },
    });
  });
}

async function withSftp<T>(auth: SshAuth, fn: (sftp: SFTPWrapper, fingerprint: string) => Promise<T>): Promise<T> {
  const session = await openSftp(auth);
  try {
    return await withTimeout(OP_MS, fn(session.sftp, session.fingerprint), "SSH-Zeitüberschreitung");
  } catch (error) {
    if (error instanceof ValidationError || error instanceof ForbiddenError) throw error;
    throw fileError(error, "SSH fehlgeschlagen");
  } finally {
    try {
      session.client.end();
    } catch {
      /* ignore */
    }
  }
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

function isMissingPath(error: unknown): boolean {
  const code = typeof error === "object" && error && "code" in error ? (error as { code?: unknown }).code : undefined;
  if (code === 2 || code === "ENOENT") return true;
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /no such file/i.test(message);
}

async function renamePath(sftp: SFTPWrapper, from: string, to: string): Promise<void> {
  if (from === "/" || to === "/") throw new ValidationError("Root lässt sich nicht umbenennen");
  const exists = await new Promise<boolean>((resolve, reject) => {
    sftp.stat(to, (err) => {
      if (!err) resolve(true);
      else if (isMissingPath(err)) resolve(false);
      else reject(err);
    });
  });
  if (exists) throw new ValidationError("Ziel existiert schon");
  await new Promise<void>((resolve, reject) => {
    sftp.rename(from, to, (err) => (err ? reject(err) : resolve()));
  });
}

type StreamCreds = {
  target: string;
  port?: number;
  username: string;
  password?: string;
  privateKey?: string;
  passphrase?: string;
  path: string;
};

async function parseStreamCreds(input: StreamCreds) {
  const auth = parseSshAuth(input);
  try {
    return { ...auth, path: resolveGuestPath(input.path || "/") };
  } catch (error) {
    throw new ValidationError(error instanceof Error ? error.message : "Invalid path");
  }
}

const SFTP_CHUNK_FALLBACK = 32 * 1024;
const SFTP_CHUNK_MAX = 224 * 1024;
const SFTP_IN_FLIGHT = 64;

function sftpChunkSize(sftp: SFTPWrapper): number {
  const raw = Number((sftp as unknown as { _maxWriteLen?: number })._maxWriteLen);
  if (!Number.isFinite(raw) || raw < 16 * 1024) return SFTP_CHUNK_FALLBACK;
  return Math.min(SFTP_CHUNK_MAX, Math.floor(raw));
}

function probePosixShell(client: Client): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (ok: boolean) => {
      if (settled) return;
      settled = true;
      resolve(ok);
    };
    const timer = setTimeout(() => done(false), 5_000);
    try {
      client.exec("sh -c 'printf proxora_posix'", (err, stream) => {
        if (err || !stream) {
          clearTimeout(timer);
          done(false);
          return;
        }
        let out = "";
        stream.on("data", (chunk: Buffer | string) => {
          out += typeof chunk === "string" ? chunk : chunk.toString("utf8");
        });
        stream.stderr?.resume();
        stream.on("close", () => {
          clearTimeout(timer);
          done(out.includes("proxora_posix"));
        });
        stream.on("error", () => {
          clearTimeout(timer);
          done(false);
        });
      });
    } catch {
      clearTimeout(timer);
      done(false);
    }
  });
}

function sshCatUpload(
  client: Client,
  remotePath: string,
  body: ReadableStream<Uint8Array> | null,
): Promise<number> {
  const cmd = `umask 022 && cat > ${shSingleQuote(remotePath)}`;
  return new Promise((resolve, reject) => {
    client.exec(cmd, (err, stream) => {
      if (err || !stream) {
        reject(err ?? new ValidationError("SSH-Exec fehlgeschlagen"));
        return;
      }
      let total = 0;
      let stderr = "";
      let exitCode: number | null = 0;
      let finished = false;
      const fail = (error: unknown) => {
        if (finished) return;
        finished = true;
        try {
          stream.destroy();
        } catch {
          /* ignore */
        }
        reject(error instanceof Error ? error : new ValidationError(String(error)));
      };
      const succeed = () => {
        if (finished) return;
        finished = true;
        resolve(total);
      };
      stream.stderr?.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf8");
        if (stderr.length > 800) stderr = stderr.slice(-800);
      });
      stream.on("error", fail);
      stream.on("exit", (code: number | undefined) => {
        if (typeof code === "number") exitCode = code;
      });
      stream.on("close", () => {
        if (finished) return;
        if (exitCode === 0) succeed();
        else fail(new ValidationError(stderr.trim().slice(0, 240) || "Upload fehlgeschlagen"));
      });
      const counter = new Transform({
        highWaterMark: 1024 * 1024,
        transform(chunk, _enc, cb) {
          total += (chunk as Buffer).length;
          cb(null, chunk);
        },
      });
      const nodeIn = body
        ? Readable.fromWeb(body as import("node:stream/web").ReadableStream<Uint8Array>, { highWaterMark: 1024 * 1024 })
        : Readable.from([]);
      nodeIn.on("error", fail);
      counter.on("error", fail);
      nodeIn.pipe(counter).pipe(stream);
    });
  });
}

function openHandle(sftp: SFTPWrapper, remotePath: string, flags: "r" | "w"): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const done = (err: Error | undefined, handle: Buffer) => {
      if (err || !handle) reject(err ?? new ValidationError("SFTP-Datei konnte nicht geöffnet werden"));
      else resolve(handle);
    };
    if (flags === "w") sftp.open(remotePath, "w", { mode: 0o644 }, done);
    else sftp.open(remotePath, "r", done);
  });
}

function closeHandle(sftp: SFTPWrapper, handle: Buffer | null | undefined): Promise<void> {
  if (!handle) return Promise.resolve();
  return new Promise((resolve) => {
    sftp.close(handle, () => resolve());
  });
}

function writeAt(sftp: SFTPWrapper, handle: Buffer, chunk: Buffer, position: number): Promise<void> {
  return new Promise((resolve, reject) => {
    sftp.write(handle, chunk, 0, chunk.length, position, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

/** Pipelined SFTP writes (ssh2 WriteStream is one packet per RTT). */
async function sftpPipelineWrite(
  sftp: SFTPWrapper,
  handle: Buffer,
  body: ReadableStream<Uint8Array> | null,
): Promise<number> {
  if (!body) return 0;
  const chunkSize = sftpChunkSize(sftp);
  const reader = body.getReader();
  const pending = new Set<Promise<void>>();
  let firstError: unknown;
  let pos = 0;
  let rest = Buffer.alloc(0);

  const launch = (chunk: Buffer, at: number) => {
    const owned = Buffer.from(chunk);
    const p = writeAt(sftp, handle, owned, at)
      .catch((err) => {
        firstError ??= err;
      })
      .finally(() => {
        pending.delete(p);
      });
    pending.add(p);
  };

  const waitSlot = async () => {
    while (pending.size >= SFTP_IN_FLIGHT) {
      await Promise.race(pending);
      if (firstError) throw firstError;
    }
  };

  const flushRest = async (all: boolean) => {
    while (rest.length >= chunkSize || (all && rest.length > 0)) {
      await waitSlot();
      const n = all && rest.length < chunkSize ? rest.length : Math.min(chunkSize, rest.length);
      const chunk = rest.subarray(0, n);
      rest = rest.subarray(n);
      const at = pos;
      pos += n;
      launch(chunk, at);
    }
  };

  try {
    while (true) {
      if (firstError) throw firstError;
      const { done, value } = await reader.read();
      if (value?.byteLength) {
        const incoming = Buffer.from(value);
        rest = rest.length ? Buffer.concat([rest, incoming]) : incoming;
        await flushRest(false);
      }
      if (done) break;
    }
    await flushRest(true);
    if (pending.size) await Promise.all([...pending]);
    if (firstError) throw firstError;
    return pos;
  } finally {
    try {
      reader.releaseLock();
    } catch {
      /* already released */
    }
  }
}

async function pumpSftpReads(sftp: SFTPWrapper, handle: Buffer, size: number, dest: PassThrough): Promise<void> {
  if (size <= 0) return;
  const chunkSize = sftpChunkSize(sftp);
  let nextIssue = 0;
  let nextEmit = 0;
  const ready = new Map<number, Buffer>();
  let inFlight = 0;
  let paused = false;
  let stopped = false;

  await new Promise<void>((resolve, reject) => {
    const stop = (err?: unknown) => {
      if (stopped) return;
      stopped = true;
      dest.off("drain", onDrain);
      dest.off("close", onClose);
      dest.off("error", onDestError);
      if (err) reject(err);
      else resolve();
    };

    const onClose = () => stop();
    const onDestError = (err: Error) => stop(err);
    const onDrain = () => {
      paused = false;
      flush();
      issue();
    };

    dest.once("close", onClose);
    dest.once("error", onDestError);
    dest.on("drain", onDrain);

    function issue() {
      if (stopped) return;
      while (!paused && inFlight < SFTP_IN_FLIGHT && nextIssue < size) {
        const at = nextIssue;
        const len = Math.min(chunkSize, size - at);
        nextIssue += len;
        inFlight++;
        const buf = Buffer.allocUnsafe(len);
        sftp.read(handle, buf, 0, len, at, (err, bytesRead, data) => {
          inFlight--;
          if (stopped) return;
          if (err) {
            stop(err);
            return;
          }
          const n = bytesRead || 0;
          if (n !== len && at + n < size) {
            stop(new ValidationError("SFTP-Lesen unvollständig"));
            return;
          }
          ready.set(at, n === data.length ? data : data.subarray(0, n));
          flush();
          issue();
        });
      }
      if (nextEmit >= size && inFlight === 0) stop();
    }

    function flush() {
      if (stopped) return;
      while (ready.has(nextEmit)) {
        const chunk = ready.get(nextEmit)!;
        ready.delete(nextEmit);
        nextEmit += chunk.length;
        if (!chunk.length) continue;
        try {
          if (!dest.write(chunk)) paused = true;
        } catch (err) {
          stop(err);
          return;
        }
        if (paused) break;
      }
      if (nextEmit >= size && inFlight === 0) stop();
    }

    issue();
  });
}

function sftpPipelineReadStream(sftp: SFTPWrapper, handle: Buffer, size: number): PassThrough {
  const dest = new PassThrough({ highWaterMark: 1024 * 1024 });
  void pumpSftpReads(sftp, handle, size, dest)
    .then(() => {
      if (!dest.destroyed) dest.end();
    })
    .catch((err) => {
      dest.destroy(err instanceof Error ? err : new Error(String(err)));
    });
  return dest;
}

function sshWire(auth: {
  target: string;
  port: number;
  username: string;
  password?: string;
  privateKey?: string;
  passphrase?: string;
}) {
  return {
    target: auth.target,
    port: auth.port,
    username: auth.username,
    password: auth.password ?? "",
    privateKey: auth.privateKey ?? "",
    passphrase: auth.passphrase ?? "",
  };
}

/** Stream a guest file over SFTP. SSH stays open until the HTTP body ends. */
export async function sftpDownloadResponse(input: StreamCreds): Promise<Response> {
  const creds = await parseStreamCreds(input);
  const session = await openSftp(creds);
  try {
    const attrs = await new Promise<{ size: number; mode: number }>((resolve, reject) => {
      session.sftp.stat(creds.path, (err, next) => {
        if (err) reject(err);
        else resolve({ size: Number(next.size ?? 0), mode: Number(next.mode ?? 0) });
      });
    });
    if (modeType(attrs.mode) === "dir") throw new ValidationError("Ist ein Ordner");
    const handle = await openHandle(session.sftp, creds.path, "r");
    const nodeStream = sftpPipelineReadStream(session.sftp, handle, attrs.size);
    let ended = false;
    const endClient = () => {
      if (ended) return;
      ended = true;
      void closeHandle(session.sftp, handle).finally(() => {
        try {
          session.client.end();
        } catch {
          /* ignore */
        }
      });
    };
    nodeStream.on("close", endClient);
    nodeStream.on("error", endClient);
    const web = Readable.toWeb(nodeStream as unknown as Readable) as unknown as ReadableStream<Uint8Array>;
    const headers = new Headers();
    headers.set("Content-Type", "application/octet-stream");
    headers.set("Content-Disposition", attachmentDisposition(guestFileName(creds.path)));
    headers.set("Cache-Control", "no-store");
    if (Number.isFinite(attrs.size) && attrs.size > 0) {
      headers.set("Content-Length", String(attrs.size));
    }
    return new Response(web, { status: 200, headers });
  } catch (error) {
    try {
      session.client.end();
    } catch {
      /* ignore */
    }
    if (error instanceof ValidationError) throw error;
    throw fileError(error, "SSH fehlgeschlagen");
  }
}

export async function sftpUploadFromStream(input: StreamCreds & { body: ReadableStream<Uint8Array> | null }): Promise<{
  path: string;
  name: string;
  size: number;
}> {
  const creds = await parseStreamCreds(input);
  const session = await openSftp(creds);
  let handle: Buffer | null = null;
  try {
    if (await probePosixShell(session.client)) {
      const total = await sshCatUpload(session.client, creds.path, input.body);
      return { path: creds.path, name: guestFileName(creds.path), size: total };
    }
    handle = await openHandle(session.sftp, creds.path, "w");
    const total = await sftpPipelineWrite(session.sftp, handle, input.body);
    await closeHandle(session.sftp, handle);
    handle = null;
    return { path: creds.path, name: guestFileName(creds.path), size: total };
  } catch (error) {
    await closeHandle(session.sftp, handle);
    await new Promise<void>((resolve) => {
      session.sftp.unlink(creds.path, () => resolve());
    });
    if (error instanceof ValidationError) throw error;
    throw fileError(error, "Upload fehlgeschlagen");
  } finally {
    try {
      session.client.end();
    } catch {
      /* ignore */
    }
  }
}

async function proxyGuestFileDownloadToPeer(
  host: Host,
  input: {
    target: string;
    port: number;
    username: string;
    password?: string;
    privateKey?: string;
    passphrase?: string;
    path: string;
    kind: "vm" | "lxc";
    vmid: number;
  },
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
      ...sshWire(input),
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
    password?: string;
    privateKey?: string;
    passphrase?: string;
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

async function proxyGuestFileUploadToPeer(
  host: Host,
  input: {
    kind: "vm" | "lxc";
    vmid: number;
    target: string;
    port: number;
    username: string;
    password?: string;
    privateKey?: string;
    passphrase?: string;
    path: string;
    body: ReadableStream<Uint8Array> | null;
    contentLength?: string | null;
  },
): Promise<{ path: string; name: string; size: number }> {
  if (!host.peerId || !host.remoteHostId) throw new ValidationError("Peer host is incomplete");
  const peer = await prisma.wireguardPeer.findUnique({ where: { id: host.peerId } });
  if (!peer?.address) throw new HostUnreachableError(host.name, "Set the colleague's Proxora IP first");
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/octet-stream",
    Authorization: `Bearer ${outboundToken(peer)}`,
    [GUEST_TRANSFER_META_HEADER]: encodeGuestTransferMeta({
      remoteHostId: host.remoteHostId,
      kind: input.kind,
      vmid: input.vmid,
      ...sshWire(input),
      path: input.path,
    }),
  };
  if (input.contentLength) headers["Content-Length"] = input.contentLength;
  const response = await fetch(`${peerHttpBase(peer)}/api/federation/guest-files/upload`, {
    method: "POST",
    headers,
    body: input.body ?? undefined,
    duplex: "half",
  } as RequestInit);
  const json = (await response.json().catch(() => ({}))) as { error?: string; path?: string; name?: string; size?: number };
  if (!response.ok) {
    throw new ValidationError(json.error || `Peer Proxora error (${response.status})`);
  }
  return {
    path: json.path || input.path,
    name: json.name || guestFileName(input.path),
    size: Number(json.size ?? 0),
  };
}

export async function streamGuestFileUpload(
  host: Host,
  input: {
    kind: "vm" | "lxc";
    vmid: number;
    target: string;
    port: number;
    username: string;
    password?: string;
    privateKey?: string;
    passphrase?: string;
    path: string;
    body: ReadableStream<Uint8Array> | null;
    contentLength?: string | null;
  },
): Promise<{ path: string; name: string; size: number }> {
  if (host.origin === HostOrigin.PEER) return proxyGuestFileUploadToPeer(host, input);
  try {
    return await sftpUploadFromStream(input);
  } catch (error) {
    if (error instanceof ValidationError || error instanceof ForbiddenError) throw error;
    throw fileError(error, "Upload fehlgeschlagen");
  }
}

export async function guestSftp(input: GuestFileRequest): Promise<GuestFileResult> {
  let path: string;
  try {
    path = resolveGuestPath(input.path || "/");
  } catch (error) {
    throw new ValidationError(error instanceof Error ? error.message : "Invalid path");
  }
  const auth = parseSshAuth(input);
  return withSftp(auth, async (sftp, fingerprint) => {
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
      case "rename": {
        let dest: string;
        try {
          dest = resolveGuestPath(input.to || "");
        } catch (error) {
          throw new ValidationError(error instanceof Error ? error.message : "Invalid path");
        }
        if (guestPathParent(path) !== guestPathParent(dest)) {
          throw new ValidationError("Umbenennen nur im selben Ordner");
        }
        await renamePath(sftp, path, dest);
        return { path: dest, via: "sftp", name: guestFileName(dest), fingerprint };
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
  const viaAgent = input.kind === "vm" && input.via !== "sftp" && !hasGuestSshAuth(input);
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
