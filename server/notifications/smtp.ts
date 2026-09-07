import { connect as tlsConnect, type TLSSocket } from "node:tls";
import { connect as netConnect, type Socket } from "node:net";
import { ValidationError } from "@/lib/errors";

export type SmtpConfig = {
  host: string;
  port?: number;
  secure?: boolean;
  username?: string;
  password?: string;
  from: string;
  to: string;
};

const TIMEOUT_MS = 20_000;

function smtpField(config: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = config[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

export function parseSmtpConfig(config: Record<string, unknown>): SmtpConfig {
  const host = smtpField(config, ["host", "smtpHost"]);
  const from = smtpField(config, ["from", "fromEmail"]);
  const to = smtpField(config, ["to", "toEmail"]);
  if (!host || !from || !to) {
    throw new ValidationError("SMTP host, from, and to are required");
  }
  const portRaw = Number(config.port ?? config.smtpPort ?? 587);
  const port = Number.isFinite(portRaw) && portRaw > 0 ? portRaw : 587;
  const secure = config.secure === true || config.secure === 1 || port === 465;
  return {
    host,
    port,
    secure,
    username: smtpField(config, ["username", "user"]) || undefined,
    password: typeof config.password === "string" ? config.password : undefined,
    from,
    to,
  };
}

export async function sendSmtpMail(
  config: SmtpConfig,
  subject: string,
  text: string,
): Promise<void> {
  let socket: Socket = await openSmtpSocket(config.host, config.port ?? 587, config.secure === true);
  try {
    await requireCode(await readReply(socket), 220);
    await requireCode(await command(socket, "EHLO proxora"), 250);
    if (!config.secure && (config.port ?? 587) !== 465) {
      const start = await command(socket, "STARTTLS");
      if (start.code === 220) {
        socket = await upgradeTls(socket, config.host);
        await requireCode(await command(socket, "EHLO proxora"), 250);
      }
    }
    if (config.username) {
      await requireCode(await command(socket, "AUTH LOGIN"), 334);
      await requireCode(await command(socket, Buffer.from(config.username).toString("base64")), 334);
      await requireCode(await command(socket, Buffer.from(config.password ?? "").toString("base64")), 235);
    }
    await requireCode(await command(socket, `MAIL FROM:<${addr(config.from)}>`), 250);
    await requireCode(await command(socket, `RCPT TO:<${addr(config.to)}>`), 250);
    await requireCode(await command(socket, "DATA"), 354);
    const body = [
      `From: ${config.from}`,
      `To: ${config.to}`,
      `Subject: ${subject.replace(/[\r\n]+/g, " ")}`,
      "MIME-Version: 1.0",
      "Content-Type: text/plain; charset=utf-8",
      "",
      text.replace(/^\./gm, ".."),
      ".",
    ].join("\r\n");
    socket.write(`${body}\r\n`);
    await requireCode(await readReply(socket), 250);
    await command(socket, "QUIT").catch(() => undefined);
  } finally {
    socket.end();
  }
}

function addr(value: string): string {
  const m = /<([^>]+)>/.exec(value);
  return (m?.[1] ?? value).trim();
}

function openSmtpSocket(host: string, port: number, secure: boolean): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = secure
      ? tlsConnect({ host, port, servername: host, timeout: TIMEOUT_MS }, () => resolve(socket))
      : netConnect({ host, port, timeout: TIMEOUT_MS }, () => resolve(socket));
    socket.setTimeout(TIMEOUT_MS, () => {
      socket.destroy();
      reject(new Error("SMTP timeout"));
    });
    socket.once("error", reject);
  });
}

function upgradeTls(socket: Socket, host: string): Promise<TLSSocket> {
  return new Promise((resolve, reject) => {
    const tls = tlsConnect({ socket, servername: host, timeout: TIMEOUT_MS }, () => resolve(tls));
    tls.setTimeout(TIMEOUT_MS, () => {
      tls.destroy();
      reject(new Error("SMTP TLS timeout"));
    });
    tls.once("error", reject);
  });
}

type SmtpReply = { code: number; lines: string[] };

function command(socket: Socket, line: string): Promise<SmtpReply> {
  socket.write(`${line}\r\n`);
  return readReply(socket);
}

function requireCode(reply: SmtpReply, code: number): SmtpReply {
  if (reply.code !== code && Math.floor(reply.code / 100) !== Math.floor(code / 100)) {
    throw new Error(reply.lines.join(" ") || `SMTP ${reply.code}`);
  }
  return reply;
}

function readReply(socket: Socket): Promise<SmtpReply> {
  return new Promise((resolve, reject) => {
    let buf = "";
    const onData = (chunk: Buffer) => {
      buf += chunk.toString("utf8");
      const parsed = parseReply(buf);
      if (!parsed) return;
      cleanup();
      resolve(parsed);
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const cleanup = () => {
      socket.off("data", onData);
      socket.off("error", onError);
    };
    socket.on("data", onData);
    socket.once("error", onError);
  });
}

function parseReply(buf: string): SmtpReply | null {
  const lines = buf.split(/\r?\n/).filter((line) => line.length > 0);
  if (!lines.length) return null;
  const last = lines[lines.length - 1] ?? "";
  if (!/^\d{3} /.test(last)) return null;
  return { code: Number(last.slice(0, 3)), lines };
}
