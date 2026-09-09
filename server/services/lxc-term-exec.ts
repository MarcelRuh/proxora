import { randomBytes } from "node:crypto";
import { WebSocket } from "ws";
import { ValidationError } from "@/lib/errors";
import { parseLxcExecPayload } from "@/lib/lxc-ssh-root";
import type { ProxmoxClient } from "@/server/proxmox/client";

function sendStdin(ws: WebSocket, text: string) {
  ws.send(`0:${Buffer.byteLength(text)}:${text}`);
}

export async function execLxcScript(
  client: ProxmoxClient,
  input: { node: string; vmid: number; script: string; rejectUnauthorized: boolean; timeoutMs?: number },
): Promise<{ stdout: string; exitCode: number }> {
  const timeoutMs = input.timeoutMs ?? 25_000;
  const term = await client.lxc.termproxy(input.node, input.vmid);
  const wsUrl = client.http.websocketUrl(`/nodes/${encodeURIComponent(input.node)}/lxc/${input.vmid}/vncwebsocket`, {
    port: term.port,
    vncticket: term.ticket,
  });
  const headers = await client.http.authHeaders();
  const begin = `__PXR_B_${randomBytes(4).toString("hex")}__`;
  const end = `__PXR_E_${randomBytes(4).toString("hex")}__`;
  const b64 = Buffer.from(input.script, "utf8").toString("base64");
  const payload = `stty -echo 2>/dev/null; echo ${begin}; echo ${b64} | base64 -d | sh; echo ${end}:$?\n`;

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl, ["binary"], {
      headers,
      rejectUnauthorized: input.rejectUnauthorized,
      perMessageDeflate: false,
    });
    let handshake = true;
    let buf = Buffer.alloc(0);
    let output = "";
    let sent = false;
    let settled = false;
    const timer = setTimeout(() => {
      finish(new ValidationError("Zeitüberschreitung in der Container-Konsole"));
    }, timeoutMs);

    const finish = (error?: Error, result?: { stdout: string; exitCode: number }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        ws.close();
      } catch {
        /* ignore */
      }
      if (error) reject(error);
      else if (result) resolve(result);
      else reject(new ValidationError("Keine Antwort aus dem Container"));
    };

    ws.on("open", () => {
      ws.send(`${term.user}:${term.ticket}\n`);
    });
    ws.on("message", (data) => {
      const chunk = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
      if (handshake) {
        buf = Buffer.concat([buf, chunk]);
        const text = buf.toString("latin1");
        if (!text.startsWith("OK") && buf.length < 2) return;
        if (!text.startsWith("OK")) {
          finish(new ValidationError("Container-Konsole: Handshake fehlgeschlagen"));
          return;
        }
        handshake = false;
        const rest = text.replace(/^OK\r?\n?/, "");
        if (rest) output += rest;
        ws.send("1:80:24:");
        if (!sent) {
          sent = true;
          setTimeout(() => {
            if (ws.readyState === WebSocket.OPEN) sendStdin(ws, payload);
          }, 250);
        }
        return;
      }
      output += chunk.toString("utf8");
      const parsed = parseLxcExecPayload(output, begin, end);
      if (parsed) finish(undefined, parsed);
    });
    ws.on("error", (err) => {
      finish(new ValidationError(err.message || "Container-Konsole nicht erreichbar"));
    });
    ws.on("close", () => {
      const parsed = parseLxcExecPayload(output, begin, end);
      if (parsed) finish(undefined, parsed);
      else finish(new ValidationError("Keine Antwort aus dem Container"));
    });
  });
}
