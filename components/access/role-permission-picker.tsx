"use client";

import { PERMISSION_CATALOG, PERMISSION_GROUPS, type Permission, type PermissionGroupId } from "@/lib/permissions";
import { useI18n } from "@/components/i18n/locale-provider";
import { Button } from "@/components/ui/button";

export function RolePermissionPicker({
  value,
  onChange,
  disabled,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
}) {
  const { locale } = useI18n();
  const selected = new Set(value);

  function toggle(id: Permission, on: boolean) {
    if (disabled) return;
    onChange(on ? [...value, id] : value.filter((p) => p !== id));
  }

  function setGroup(group: PermissionGroupId, on: boolean) {
    if (disabled) return;
    const ids = PERMISSION_CATALOG.filter((p) => p.group === group).map((p) => p.id);
    if (on) onChange([...new Set([...value, ...ids])]);
    else onChange(value.filter((p) => !ids.includes(p as Permission)));
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={() => onChange(PERMISSION_CATALOG.map((p) => p.id))}>
          {locale === "en" ? "All" : "Alle"}
        </Button>
        <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={() => onChange([])}>
          {locale === "en" ? "None" : "Keine"}
        </Button>
      </div>
      {PERMISSION_GROUPS.map((group) => {
        const items = PERMISSION_CATALOG.filter((p) => p.group === group.id);
        const count = items.filter((p) => selected.has(p.id)).length;
        const allOn = count === items.length;
        return (
          <section key={group.id} className="rounded-[4px] border border-border p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <h3 className="text-sm font-medium">{locale === "en" ? group.en : group.de}</h3>
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <input type="checkbox" checked={allOn} disabled={disabled} onChange={(e) => setGroup(group.id, e.target.checked)} />
                {count}/{items.length}
              </label>
            </div>
            <div className="grid gap-1.5 sm:grid-cols-2">
              {items.map((perm) => (
                <label key={perm.id} className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={selected.has(perm.id)}
                    disabled={disabled}
                    onChange={(e) => toggle(perm.id, e.target.checked)}
                  />
                  <span>
                    <span className="block">{locale === "en" ? perm.en : perm.de}</span>
                    <span className="font-mono text-[10px] text-muted-foreground">{perm.id}</span>
                  </span>
                </label>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
