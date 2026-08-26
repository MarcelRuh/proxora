# Authorization (RBAC)

Permissions are strings stored on `Role.permissions`.

Examples:

```
hosts.view hosts.create hosts.edit hosts.delete hosts.reboot hosts.console
vm.view vm.create vm.edit vm.delete vm.start vm.stop vm.console vm.snapshot vm.clone vm.migrate
lxc.view lxc.create lxc.edit lxc.delete lxc.start lxc.stop lxc.console lxc.snapshot lxc.clone
storage.view storage.manage
zfs.view zfs.manage
updates.view updates.execute
users.view users.manage
roles.view roles.manage
audit.view
tasks.view
settings.view settings.manage
```

## System roles

| Role | Intent |
| --- | --- |
| Super Admin | Everything |
| Administrator | Hosts, guests, storage, updates. No user/role admin |
| Operator | View + start/stop + consoles |
| Viewer | Read-only |
| Custom | Any subset |

System roles cannot be deleted.

## Host scope

`UserHostAccess` optionally restricts a user to named hosts. An empty list means **all hosts**. Restricted users receive `404` for hosts outside the allow-list so existence is not leaked.

## Enforcement

`requirePermission()` in route handlers is the source of truth. Guest power actions map to `vm.start` / `vm.stop` (and LXC equivalents). Destructive actions additionally require `confirm: true` in the JSON body.
