# Proxmox VE API

All host communication goes through `ProxmoxClient` (`server/proxmox/client.ts`).

```ts
const proxmox = createProxmoxClient(config);
await proxmox.nodes.list();
await proxmox.vms.start(node, vmid);
await proxmox.lxc.create(node, params);
await proxmox.storage.list(node);
await proxmox.zfs.pools(node);
await proxmox.tasks.get(node, upid);
await proxmox.updates.list(node);
await proxmox.cluster.status();
```

## Base URL

`{host}/api2/json/...`

Example: `https://192.168.1.10:8006/api2/json/version`

## Authentication

### API token (preferred)

```
Authorization: PVEAPIToken=root@pam!manager=<secret>
```

Create a token in Datacenter → Permissions → API Tokens. Privilege separation can stay disabled for a management token, or you can grant a minimal ACL.

### Username / password

`POST /access/ticket` returns `ticket` + `CSRFPreventionToken`. The client caches the ticket for ~90 minutes and sends:

```
Cookie: PVEAuthCookie=<ticket>
CSRFPreventionToken: <token>
```

## TLS

Self-signed certificates are supported per host (`allowInsecureTls`). Verification is disabled only for that host's undici `Agent`, never globally.

## Connection test

Adding a host runs:

1. `GET /version`
2. `GET /cluster/status` (standalone hosts still answer)
3. `GET /nodes`
4. `GET /access/permissions`

## Guest and storage endpoints

| Action | Method | Path |
| --- | --- | --- |
| List guests | GET | `/cluster/resources?type=vm` |
| VM start/stop/... | POST | `/nodes/{node}/qemu/{vmid}/status/{action}` |
| VM create | POST | `/nodes/{node}/qemu` |
| LXC create | POST | `/nodes/{node}/lxc` |
| Snapshots | POST/DELETE | `/nodes/{node}/qemu\|lxc/{vmid}/snapshot` |
| Storage | GET | `/nodes/{node}/storage` |
| ZFS | GET | `/nodes/{node}/disks/zfs` |
| APT list | GET | `/nodes/{node}/apt/update` |
| APT refresh | POST | `/nodes/{node}/apt/update` |
| APT upgrade | POST | `/nodes/{node}/apt/upgrade` |
| Tasks | GET | `/nodes/{node}/tasks` |

Updates never run arbitrary SSH commands. They use the APT API above.

## Errors

HTTP failures become `ProxmoxApiError`. Connection failures become `HostUnreachableError` and do not fail sibling hosts.
