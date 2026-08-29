# WebSocket console

The browser never receives Proxmox tickets, tokens or passwords.

```
xterm.js     --ws /ws/console-->  Proxora  --wss-->  Proxmox termproxy
noVNC (VGA)  --ws /ws/vnc------>  Proxora  --wss-->  Proxmox vncproxy
```

## Serial / shell (xterm.js)

1. Authenticated UI opens `WebConsole` (`components/console/web-console.tsx`).
2. Browser connects to `ws(s)://{manager}/ws/console?hostId&node&kind&vmid`.
3. The Node proxy (`server/ws/console-proxy.ts`) validates the session cookie and RBAC (`vm.console` / `lxc.console` / `hosts.console`).
4. Backend calls Proxmox `POST .../termproxy` and receives `{ port, ticket, user }`.
5. Backend opens `wss://{pve}/api2/json/nodes/{node}/.../vncwebsocket?port&vncticket`.
6. First upstream message: `{user}:{ticket}\n`.
7. After `OK`, the termproxy protocol is used:

| Direction | Frame |
| --- | --- |
| Browser → PVE | `0:{byteLength}:{data}` input |
| Browser → PVE | `1:{cols}:{rows}:` resize |
| Browser → PVE | `2` keepalive (30s) |
| PVE → Browser | raw PTY bytes (no wrapper) |

This matches [pve-xtermjs](https://github.com/proxmox/pve-xtermjs).

## VGA (noVNC, VMs only)

1. VM detail opens `VncConsole` (`components/console/vnc-console.tsx`) by default. Serial remains available as a toggle.
2. Browser connects to `ws(s)://{manager}/ws/vnc?hostId&node&kind=vm&vmid`.
3. Backend calls `POST /nodes/{node}/qemu/{vmid}/vncproxy` with `{ websocket: 1 }`.
4. Backend opens the same `vncwebsocket` path, sends `{user}:{ticket}\n`, waits for `OK`, then pipes **raw RFB** both ways. The `OK` acknowledgement never reaches the browser.
5. `@novnc/novnc` speaks RFB against Proxora. Tickets stay on the server.

LXC and node shells stay on termproxy. QEMU SPICE is not implemented.

## Process model

- **Development:** `next dev` on `:3000` plus `tsx server/ws/standalone.ts` on `:3001`. Set `NEXT_PUBLIC_WS_URL=ws://localhost:3001` if you do not use the combined server.
- **Production:** `node dist/server.cjs` serves Next.js and upgrades `/ws/console` and `/ws/vnc` on the same port.
