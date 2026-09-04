# Authorization (RBAC)

Two independent layers:

1. **Role = WHAT** — fine-grained action permissions stored on `Role.permissions`.
2. **User scope = WHERE** — optional host allow-list (`UserHostAccess`) and optional guest allow-list (`UserGuestAccess`). Empty lists mean *all* hosts / *all* guests.

Example: a custom role with only `vm.view` + `vm.start` + `vm.shutdown`, assigned to a user scoped to host A and VM 105. That user can start/stop that one VM and nothing else.

## Permissions

Each catalog entry is a single action. Labels in the role editor are in DE/EN; the stored id is stable.

| Group | Examples |
| --- | --- |
| Hosts | `hosts.view` `hosts.create` `hosts.update` `hosts.credentials` `hosts.delete` `hosts.reboot` `hosts.shutdown` `hosts.console` |
| VM | `vm.view` `vm.create` `vm.config` `vm.delete` `vm.start` `vm.shutdown` `vm.force-stop` `vm.reboot` `vm.reset` `vm.pause` `vm.resume` `vm.console` `vm.snapshot.create` `vm.snapshot.delete` `vm.snapshot.rollback` `vm.clone` `vm.migrate` |
| LXC | same pattern without pause/reset; migrate is `lxc.migrate`; hard stop is `lxc.force-stop` |
| Storage | `storage.view` `zfs.view` |
| Backup | `backup.view` `backup.run` `backup.restore` `backup.delete` `backup.job.create` `backup.job.update` `backup.job.delete` |
| Updates | `updates.view` `updates.check` `updates.upgrade` `proxora.update` |
| Access | `users.*` / `roles.*` as view/create/update/delete |
| System | `audit.view` `tasks.view` `settings.view` `settings.update` `notifications.*` |

Coarse strings from older releases (`hosts.edit`, `vm.edit`, `vm.stop`, `backup.manage`, `users.manage`, …) still work via aliases until the role is saved again.

## System roles

| Role | Intent |
| --- | --- |
| Super Admin | Everything |
| Administrator | Hosts, guests, storage, backups, host updates. No user/role admin, no Proxora self-update, no settings write |
| Operator | View + start/shutdown/force-stop/reboot + consoles |
| Viewer | Read-only |
| Custom | Any subset of the catalog |

System roles cannot be deleted. Their permission lists are refreshed from code on process start.

## Host and guest scope

- No host rows → all hosts (unless guest rows imply a host set).
- Host rows → only those hosts (404 outside the list).
- No guest rows → all guests on allowed hosts.
- Guest rows → only those `(hostId, kind, vmid)` tuples.

`requirePermission()` in route handlers is the source of truth. Guest power actions map through `permissionForGuestAction()`. Destructive actions additionally require `confirm: true` in the JSON body.
