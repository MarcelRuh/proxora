import { NotFoundError, ForbiddenError, ValidationError } from "@/lib/errors";
import { canAccessGuest, type AccessScope } from "@/lib/guest-scope";
import { parseBackupVolid, type BackupKind } from "@/lib/backup";

/** Guest-scoped users only see listed VMs/CTs; unscoped users keep host-wide behaviour. */
export function isGuestScoped(user: AccessScope): boolean {
  return user.allowedGuests !== null;
}

/** A VMID is unique per host, so "unknown" kind matches either VM or CT grants. */
export function canAccessVmid(user: AccessScope, hostId: string, vmid: number, kind: BackupKind = "unknown"): boolean {
  if (kind === "vm" || kind === "lxc") return canAccessGuest(user, hostId, kind, vmid);
  return canAccessGuest(user, hostId, "vm", vmid) || canAccessGuest(user, hostId, "lxc", vmid);
}

export function parseVmidList(raw: string): number[] {
  const parts = raw.split(/[,\s]+/).filter(Boolean);
  const out: number[] = [];
  for (const part of parts) {
    if (!/^\d+$/.test(part)) throw new ValidationError(`Ungültige VMID: ${part}`);
    out.push(Number(part));
  }
  return out;
}

function deny(): never {
  throw new NotFoundError("Guest not found");
}

export function assertVmidListAccess(user: AccessScope, hostId: string, raw: string) {
  if (!isGuestScoped(user)) return;
  const vmids = parseVmidList(raw);
  if (!vmids.length) deny();
  for (const vmid of vmids) if (!canAccessVmid(user, hostId, vmid)) deny();
}

/** Backup archives whose owner cannot be derived are treated as out of scope. */
export function assertVolidAccess(user: AccessScope, hostId: string, volid: string, vmidHint?: number | null) {
  if (!isGuestScoped(user)) return;
  const parsed = parseBackupVolid(volid);
  const vmid = parsed.vmid ?? vmidHint ?? null;
  if (vmid == null || !canAccessVmid(user, hostId, vmid, parsed.kind)) deny();
}

export function assertBackupJobAccess(
  user: AccessScope,
  hostId: string,
  job: { all?: boolean | null; vmid?: string | null },
) {
  if (!isGuestScoped(user)) return;
  if (job.all || !job.vmid?.trim()) {
    throw new ForbiddenError("Backup jobs for all guests require host-wide access");
  }
  assertVmidListAccess(user, hostId, job.vmid);
}

export function assertHostWideBackupAction(user: AccessScope) {
  if (isGuestScoped(user)) {
    throw new ForbiddenError("This action requires host-wide access");
  }
}
