import { createServer } from "node:http";
import { parse } from "node:url";
import { WebSocketServer } from "ws";
import { logger } from "@/lib/logger";
import { attachConsoleProxy } from "@/server/ws/console-proxy";

const port = Number(process.env.WS_PORT ?? 3001);
const hostname = process.env.HOSTNAME ?? "0.0.0.0";

const server = createServer((_req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("proxora console proxy");
});

const wss = new WebSocketServer({ noServer: true, perMessageDeflate: false });
attachConsoleProxy(wss);

server.on("upgrade", (req, socket, head) => {
  const { pathname } = parse(req.url ?? "");
  if (pathname === "/ws/console" || pathname === "/ws/vnc") {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
    return;
  }
  socket.destroy();
});

server.listen(port, hostname, () => {
  logger.info({ port }, "Console WebSocket proxy listening");
});
