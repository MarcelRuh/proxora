# WebSocket console

The browser never receives Proxmox tickets, tokens or passwords.

```
xterm.js  --ws-->  Proxora  --wss-->  Proxmox termproxy
```

## Flow

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

## Process model

- **Development:** `next dev` on `:3000` plus `tsx server/ws/standalone.ts` on `:3001`. Set `NEXT_PUBLIC_WS_URL=ws://localhost:3001` if you do not use the combined server.
- **Production:** `tsx server/index.ts` serves Next.js and upgrades `/ws/console` on the same port.

QEMU VGA/SPICE (noVNC) is not implemented in v1. The console is the native **xterm.js / termproxy** console used by Proxmox for LXC, node shell, and serial-enabled VMs.
