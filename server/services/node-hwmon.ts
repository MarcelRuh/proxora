import { WebSocket } from "ws";
import { cpuTempFromHwmonDump, type CpuTempReading } from "@/lib/cpu-temp";
import { logger } from "@/lib/logger";
import type { ProxmoxClient } from "@/server/proxmox/client";

/** Markers are split so the echoed command line does not contain them. */
const HWMON_CMD =
  "printf 'PROXORA_'; printf 'HWMON\\n'; for f in /sys/class/hwmon/hwmon*/temp*_input; do [ -r \"$f\" ] || continue; d=${f%/*}; n=$(cat \"$d/name\" 2>/dev/null); l=$(cat \"${f%_input}_label\" 2>/dev/null); v=$(cat \"$f\" 2>/dev/null); printf 'PROXORA_'; printf 'ROW:%s|%s|%s\\n' \"$n\" \"$l\" \"$v\"; done; printf 'PROXORA_'; printf 'TEMP_'; printf 'END\\n'";

function stripAnsi(text: string): string {
  return text.replace(/\u001b\[[0-9;?]*[A-Za-z]/g, "");
}

/**
 * Stock Proxmox has no temperature API. One node shell reads hwmon, then closes.
 * Needs the same console permission as the host terminal.
 */
export type HwmonRead =
  | { outcome: "value"; reading: CpuTempReading }
  | { outcome: "none" }
  | { outcome: "failed" };

function hwmonFromDump(text: string): HwmonRead {
  const reading = cpuTempFromHwmonDump(text);
  if (reading) return { outcome: "value", reading };
  if (text.includes("PROXORA_TEMP_END")) return { outcome: "none" };
  return { outcome: "failed" };
}

export function readNodeHwmon(client: ProxmoxClient, node: string): Promise<HwmonRead> {
  return new Promise((resolve) => {
    let socket: WebSocket | null = null;
    let settled = false;
    let buf = "";
    const finish = (value: HwmonRead) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        socket?.close();
      } catch {
        /* already closed */
      }
      resolve(value);
    };
    const timer = setTimeout(() => finish(hwmonFromDump(stripAnsi(buf))), 8_000);

    void (async () => {
      try {
        const term = await client.nodes.termproxy(node);
        const url = client.http.websocketUrl(`/nodes/${encodeURIComponent(node)}/vncwebsocket`, {
          port: term.port,
          vncticket: term.ticket,
        });
        const headers = await client.http.authHeaders();
        const ws = new WebSocket(url, ["binary"], {
          headers,
          rejectUnauthorized: !client.http.tlsInsecure(),
          perMessageDeflate: false,
        });
        socket = ws;
        let authed = false;
        ws.on("open", () => {
          ws.send(`${term.user}:${term.ticket}\n`);
        });
        ws.on("message", (data) => {
          const chunk = typeof data === "string" ? data : data.toString("latin1");
          if (!authed) {
            buf += chunk;
            if (!buf.startsWith("OK") && buf.length < 8) return;
            if (!buf.startsWith("OK")) {
              finish({ outcome: "failed" });
              return;
            }
            authed = true;
            buf = "";
            ws.send("1:80:24:");
            setTimeout(() => {
              if (settled || ws.readyState !== WebSocket.OPEN) return;
              const cmd = `${HWMON_CMD}\n`;
              ws.send(`0:${Buffer.byteLength(cmd)}:${cmd}`);
            }, 400);
            return;
          }
          buf += chunk;
          const plain = stripAnsi(buf);
          if (plain.includes("PROXORA_TEMP_END")) finish(hwmonFromDump(plain));
        });
        ws.on("error", () => finish({ outcome: "failed" }));
        ws.on("close", () => finish(hwmonFromDump(stripAnsi(buf))));
      } catch (error) {
        logger.debug({ err: error instanceof Error ? error.message : error, node }, "CPU hwmon read failed");
        finish({ outcome: "failed" });
      }
    })();
  });
}
