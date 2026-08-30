# WebSocket console

The browser never receives Proxmox API tickets or tokens. VGA consoles get a short-lived 8-character RFB password so noVNC can authenticate to QEMU.

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
3. Backend calls `POST /nodes/{node}/qemu/{vmid}/vncproxy` with `{ websocket: 1, generate-password: 1 }` (falls back without `generate-password` on older PVE).
4. Backend opens the same `vncwebsocket` path. Modern PVE already starts RFB (the `vncticket` query is enough). Older PVE still expects `{user}:{ticket}\n` and replies `OK`; the proxy only sends that line if RFB does not arrive first. Sending the ticket into a live RFB stream makes QEMU close the socket.
5. The browser receives a JSON `vnc-auth` frame with the RFB password, replies `vnc-ready`, then `@novnc/novnc` speaks RFB. The PVE `OK` line never reaches the browser. Without the RFB password, QEMU VNC auth fails and the console stays on “connecting”.
6. VGA is only opened when the VM is running (or paused). A stopped VM shows a hint instead of a failed WebSocket.
7. Clipboard: browser paste via `clipboardPasteFrom`; VM copy arrives as a `clipboard` event and is written to the local clipboard. Ctrl+Alt+Del is a labeled button.

LXC and node shells stay on termproxy. QEMU SPICE is not implemented.

## Process model

- **Development:** `next dev` on `:3000` plus `tsx server/ws/standalone.ts` on `:3001`. Set `NEXT_PUBLIC_WS_URL=ws://localhost:3001` if you do not use the combined server.
- **Production:** `node dist/server.cjs` serves Next.js and upgrades `/ws/console` and `/ws/vnc` on the same port.
