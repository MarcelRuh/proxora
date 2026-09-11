import "./node-als";
import { createServer } from "node:http";
import { parse } from "node:url";
import next from "next";
import { WebSocketServer } from "ws";
import { logger } from "@/lib/logger";
import { attachConsoleProxy } from "@/server/ws/console-proxy";
import { attachGuestFileUpload } from "@/server/ws/guest-file-upload";
import { handleNodeGuestFileTransfer } from "@/server/http/guest-file-node";
import { GUEST_FILE_UPLOAD_WS_PATH } from "@/lib/guest-file-http";
import { startAptRefreshScheduler } from "@/server/services/apt-refresh";
import { startBackupWatchScheduler } from "@/server/services/backup-watch";
import { startDiskWatchScheduler } from "@/server/services/disk-watch";
import { startZfsWatchScheduler } from "@/server/services/zfs-watch";
import { startHostReconnectScheduler } from "@/server/services/host-reconnect";
import { startPeerSyncScheduler } from "@/server/services/peer-sync";
import { announcePeerUpdateToPeers } from "@/server/services/peer-update";
import { startUsageTelemetry } from "@/server/services/usage-telemetry";
import { writeWireguardConfig } from "@/server/services/wireguard-service";
import { ensureSystemRoles } from "@/server/services/role-sync";

const dev = process.env.NODE_ENV !== "production";
const port = Number(process.env.PORT ?? 3000);
// Docker sets HOSTNAME to the container id — never bind to that.
const listenHost = process.env.LISTEN_HOST ?? "0.0.0.0";
const nextHostname = listenHost === "0.0.0.0" ? "localhost" : listenHost;

async function main() {
  const app = next({ dev, hostname: nextHostname, port });
  await app.prepare();
  const handle = app.getRequestHandler();
  const upgradeHandler = app.getUpgradeHandler?.();

  const server = createServer((req, res) => {
    void (async () => {
      try {
        if (await handleNodeGuestFileTransfer(req, res)) return;
      } catch (error) {
        logger.error({ err: error }, "Guest file transfer failed");
        if (!res.headersSent) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Internal server error" }));
        }
        return;
      }
      handle(req, res, parse(req.url ?? "", true));
    })();
  });

  const wss = new WebSocketServer({ noServer: true, perMessageDeflate: false });
  const uploadWss = new WebSocketServer({
    noServer: true,
    perMessageDeflate: false,
    maxPayload: 8 * 1024 * 1024,
  });
  attachConsoleProxy(wss);
  attachGuestFileUpload(uploadWss);

  server.on("upgrade", (req, socket, head) => {
    const { pathname } = parse(req.url ?? "");
    if (pathname === GUEST_FILE_UPLOAD_WS_PATH) {
      uploadWss.handleUpgrade(req, socket, head, (ws) => {
        uploadWss.emit("connection", ws, req);
      });
      return;
    }
    if (pathname === "/ws/console" || pathname === "/ws/vnc" || pathname === "/api/federation/ws") {
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit("connection", ws, req);
      });
      return;
    }
    if (upgradeHandler) {
      void upgradeHandler(req, socket, head);
    }
  });

  server.listen(port, listenHost, () => {
    logger.info({ port, listenHost, dev }, "Proxora listening");
    void ensureSystemRoles();
    void writeWireguardConfig().catch((error) => logger.warn({ err: error }, "WireGuard config rewrite failed"));
    startHostReconnectScheduler();
    startPeerSyncScheduler();
    startAptRefreshScheduler();
    startBackupWatchScheduler();
    startDiskWatchScheduler();
    startZfsWatchScheduler();
    void announcePeerUpdateToPeers({ updating: false }).catch((error) =>
      logger.warn({ err: error }, "Peer update recovery announce failed"),
    );
    startUsageTelemetry();
  });
}

main().catch((error) => {
  logger.error({ err: error }, "Failed to start server");
  process.exit(1);
});
