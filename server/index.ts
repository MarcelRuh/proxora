import { createServer } from "node:http";
import { parse } from "node:url";
import next from "next";
import { WebSocketServer } from "ws";
import { logger } from "@/lib/logger";
import { attachConsoleProxy } from "@/server/ws/console-proxy";

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
    handle(req, res, parse(req.url ?? "", true));
  });

  const wss = new WebSocketServer({ noServer: true });
  attachConsoleProxy(wss);

  server.on("upgrade", (req, socket, head) => {
    const { pathname } = parse(req.url ?? "");
    if (pathname === "/ws/console") {
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
  });
}

main().catch((error) => {
  logger.error({ err: error }, "Failed to start server");
  process.exit(1);
});
