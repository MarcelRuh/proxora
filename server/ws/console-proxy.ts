import type { IncomingMessage } from "node:http";
import { WebSocket, type WebSocketServer } from "ws";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/db";
import { SESSION_COOKIE } from "@/lib/env";
import { AUDIT_ACTIONS } from "@/lib/audit-actions";
import { hasPermission } from "@/lib/permissions";
import { getSessionFromToken, assertGuestAccess, canAccessHost } from "@/server/auth/session-core";
import { writeAuditLog } from "@/server/services/audit-service";
import { clientForHost } from "@/server/services/host-service";
import { consumeProxmoxVncHandshake, wsPayloadToBuffer } from "@/lib/vnc-handshake";
import { rfbPasswordFromVncProxy } from "@/lib/vnc-password";

function cookieValue(req: IncomingMessage, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return decodeURIComponent(rest.join("="));
  }
  return undefined;
}

export type ConsoleKind = "vm" | "lxc" | "node";

function asBuffer(data: WebSocket.RawData): Buffer {
  return wsPayloadToBuffer(data as Buffer | ArrayBuffer | Buffer[] | string);
}

export function attachConsoleProxy(wss: WebSocketServer) {
  wss.on("connection", (client, req) => {
    void handleConnection(client, req);
  });
}

async function handleConnection(browser: WebSocket, req: IncomingMessage) {
  const url = new URL(req.url ?? "", "http://localhost");
  const hostId = url.searchParams.get("hostId") ?? "";
  const node = url.searchParams.get("node") ?? "";
  const kind = (url.searchParams.get("kind") ?? "node") as ConsoleKind;
  const vmid = url.searchParams.get("vmid");
  const cols = Number(url.searchParams.get("cols") ?? 80);
  const rows = Number(url.searchParams.get("rows") ?? 24);
  const cmd = url.searchParams.get("cmd");
  const display = url.pathname.endsWith("/vnc") || url.searchParams.get("display") === "vga" ? "vga" : "serial";
  if (cmd && (kind !== "node" || cmd !== "upgrade")) {
    browser.close(4400, "Invalid console command");
    return;
  }
  if (display === "vga" && kind !== "vm") {
    browser.close(4400, "VGA console is only available for VMs");
    return;
  }

  const session = await getSessionFromToken(cookieValue(req, SESSION_COOKIE));
  if (!session) {
    browser.close(4401, "Unauthorized");
    return;
  }

  const permission =
    kind === "node" ? "hosts.console" : kind === "vm" ? "vm.console" : "lxc.console";
  if (!hasPermission(session.user.role.permissions, permission)) {
    browser.close(4403, "Forbidden");
    return;
  }

  try {
    const host = await prisma.host.findUnique({ where: { id: hostId } });
    if (!host) {
      browser.close(4404, "Host not found");
      return;
    }
    if (!canAccessHost(session.user, hostId)) {
      browser.close(4404, "Host not found");
      return;
    }
    if ((kind === "vm" || kind === "lxc") && vmid) {
      try {
        assertGuestAccess(session.user, hostId, kind, Number(vmid));
      } catch {
        browser.close(4404, "Guest not found");
        return;
      }
    }

    const proxmox = await clientForHost(host);
    const term =
      display === "vga"
        ? await openVmVncProxy(proxmox, node, Number(vmid))
        : kind === "node"
          ? await proxmox.nodes.termproxy(node, cmd === "upgrade" ? { cmd: "upgrade" } : undefined)
          : kind === "vm"
            ? await proxmox.vms.termproxy(node, Number(vmid))
            : await proxmox.lxc.termproxy(node, Number(vmid));

    const path =
      kind === "node"
        ? `/nodes/${encodeURIComponent(node)}/vncwebsocket`
        : kind === "vm"
          ? `/nodes/${encodeURIComponent(node)}/qemu/${vmid}/vncwebsocket`
          : `/nodes/${encodeURIComponent(node)}/lxc/${vmid}/vncwebsocket`;

    const wsUrl = proxmox.http.websocketUrl(path, {
      port: term.port,
      vncticket: term.ticket,
    });
    const headers = await proxmox.http.authHeaders();

    const remote = new WebSocket(wsUrl, ["binary"], {
      headers,
      rejectUnauthorized: !host.allowInsecureTls,
    } as import("ws").ClientOptions);

    const closeBoth = (code?: number, reason?: string) => {
      try {
        remote.close(code);
      } catch {
        /* ignore */
      }
      try {
        browser.close(code, reason);
      } catch {
        /* ignore */
      }
    };

    if (display === "vga") {
      pipeVnc(browser, remote, `${term.user}:${term.ticket}\n`, rfbPasswordFromVncProxy(term), closeBoth);
    } else {
      pipeTerm(browser, remote, term, cols, rows, closeBoth);
    }

    await writeAuditLog({
      userId: session.user.id,
      action: AUDIT_ACTIONS.CONSOLE_OPENED,
      target: `${kind}:${display}:${node}:${vmid ?? ""}`,
      hostId: host.id,
      result: "SUCCESS",
    });
  } catch (error) {
    logger.error({ err: error }, "Failed to open console");
    if (browser.readyState === WebSocket.OPEN) {
      try {
        browser.send(JSON.stringify({ type: "status", status: "error", message: "Failed to open console" }));
      } catch {
        /* ignore */
      }
    }
    browser.close(1011, "Failed to open console");
  }
}

function pipeTerm(
  browser: WebSocket,
  remote: WebSocket,
  term: { user: string; ticket: string },
  cols: number,
  rows: number,
  closeBoth: (code?: number, reason?: string) => void,
) {
  remote.on("open", () => {
    remote.send(Buffer.from(`${term.user}:${term.ticket}\n`));
    if (browser.readyState === WebSocket.OPEN) {
      browser.send(JSON.stringify({ type: "status", status: "connected" }));
    }
    setTimeout(() => {
      if (remote.readyState === WebSocket.OPEN) {
        remote.send(Buffer.from(`1:${cols}:${rows}:`));
      }
    }, 250);
  });

  remote.on("message", (data) => {
    if (browser.readyState === WebSocket.OPEN) browser.send(data);
  });

  browser.on("message", (data) => {
    if (remote.readyState !== WebSocket.OPEN) return;
    const text = typeof data === "string" ? data : asBuffer(data).toString();
    try {
      const parsed = JSON.parse(text) as {
        type?: string;
        cols?: number;
        rows?: number;
        data?: string;
      };
      if (parsed.type === "resize" && parsed.cols && parsed.rows) {
        remote.send(Buffer.from(`1:${parsed.cols}:${parsed.rows}:`));
        return;
      }
      if (parsed.type === "input" && parsed.data !== undefined) {
        remote.send(Buffer.from(`0:${Buffer.byteLength(parsed.data)}:${parsed.data}`));
        return;
      }
      if (parsed.type === "ping") {
        remote.send(Buffer.from("2"));
      }
    } catch {
      remote.send(Buffer.from(`0:${Buffer.byteLength(text)}:${text}`));
    }
  });

  remote.on("close", () => closeBoth());
  browser.on("close", () => closeBoth());
  remote.on("error", (err) => {
    logger.warn({ err: err.message }, "Console upstream error");
    closeBoth(1011, "Upstream error");
  });
  browser.on("error", () => closeBoth());
}

async function openVmVncProxy(
  proxmox: Awaited<ReturnType<typeof clientForHost>>,
  node: string,
  vmid: number,
) {
  try {
    return await proxmox.vms.vncproxy(node, vmid, { "generate-password": 1 });
  } catch (error) {
    logger.warn({ err: error instanceof Error ? error.message : error, node, vmid }, "vncproxy generate-password failed, retrying");
    return proxmox.vms.vncproxy(node, vmid);
  }
}

function pipeVnc(
  browser: WebSocket,
  remote: WebSocket,
  ticketLine: string,
  password: string,
  closeBoth: (code?: number, reason?: string) => void,
) {
  let handshake: Buffer = Buffer.alloc(0);
  let upstreamReady = false;
  let clientReady = false;
  const toRemote: Buffer[] = [];
  let leftover = Buffer.alloc(0);

  const handshakeTimer = setTimeout(() => {
    if (!upstreamReady || !clientReady) closeBoth(1011, "VNC handshake timeout");
  }, 15_000);

  const sendRfb = (target: WebSocket, chunk: Buffer) => {
    if (target.readyState === WebSocket.OPEN) target.send(chunk, { binary: true });
  };

  const flush = () => {
    if (!upstreamReady || !clientReady) return;
    clearTimeout(handshakeTimer);
    if (leftover.length) {
      sendRfb(browser, leftover);
      leftover = Buffer.alloc(0);
    }
    if (remote.readyState !== WebSocket.OPEN) return;
    for (const chunk of toRemote.splice(0)) sendRfb(remote, chunk);
  };

  // Modern PVE authenticates via vncticket in the URL and starts RFB immediately.
  // Sending `{user}:{ticket}` then is forwarded into QEMU and the socket dies (1006).
  // Older PVE still waits for that line and replies `OK` first — send it only if RFB never arrives.
  let ticketTimer: ReturnType<typeof setTimeout> | undefined;
  remote.on("open", () => {
    ticketTimer = setTimeout(() => {
      if (upstreamReady || handshake.length || remote.readyState !== WebSocket.OPEN) return;
      remote.send(Buffer.from(ticketLine));
    }, 400);
  });

  remote.on("message", (data) => {
    const chunk = asBuffer(data);
    if (!upstreamReady) {
      const next = consumeProxmoxVncHandshake(handshake, chunk);
      handshake = Buffer.from(next.rest);
      if (!next.done) return;
      if (ticketTimer) clearTimeout(ticketTimer);
      if ("error" in next && next.error) {
        logger.warn({ err: next.error }, "VNC handshake failed");
        closeBoth(1011, "VNC handshake failed");
        return;
      }
      upstreamReady = true;
      leftover = Buffer.from(next.rest);
      if (browser.readyState === WebSocket.OPEN) {
        browser.send(JSON.stringify({ type: "vnc-auth", password }));
      }
      flush();
      return;
    }
    if (!clientReady) {
      leftover = Buffer.concat([leftover, chunk]);
      return;
    }
    sendRfb(browser, chunk);
  });

  browser.on("message", (data) => {
    if (!clientReady) {
      const text = typeof data === "string" ? data : asBuffer(data).toString();
      try {
        const parsed = JSON.parse(text) as { type?: string };
        if (parsed.type === "vnc-ready") {
          clientReady = true;
          flush();
          return;
        }
      } catch {
        /* RFB bytes before the client is attached */
      }
      toRemote.push(asBuffer(data));
      flush();
      return;
    }
    sendRfb(remote, asBuffer(data));
  });

  remote.on("close", () => closeBoth());
  browser.on("close", () => closeBoth());
  remote.on("error", (err) => {
    logger.warn({ err: err.message }, "VNC upstream error");
    closeBoth(1011, "Upstream error");
  });
  browser.on("error", () => closeBoth());
}
