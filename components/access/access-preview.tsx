"use client";

import { PERMISSION_CATALOG } from "@/lib/permissions";
import type { AccessPreview } from "@/lib/access-preview";
import { useI18n } from "@/components/i18n/locale-provider";

export function AccessPreviewCard({ preview }: { preview: AccessPreview }) {
  const { t, locale } = useI18n();
  const where = [
    preview.hostMode === "all" ? t("users.previewAllHosts") : t("users.previewHosts", { names: preview.hostNames.join(", ") }),
    preview.guestMode === "all"
      ? t("users.previewAllGuests")
      : preview.guests
          .map((g) => {
            const id = `${g.hostName} · ${g.kind.toUpperCase()} ${g.vmid}`;
            return g.name ? `${id} (${g.name})` : id;
          })
          .join(", "),
  ].join(" · ");
  const actions =
    preview.actions.length === 0
      ? t("users.previewNoActions")
      : preview.actions
          .map((id) => {
            const meta = PERMISSION_CATALOG.find((p) => p.id === id);
            return locale === "en" ? (meta?.en ?? id) : (meta?.de ?? id);
          })
          .join(", ");

  return (
    <div className="rounded-[4px] border border-border bg-white/[0.03] p-3 text-sm">
      <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t("users.preview")}</p>
      <p>
        <span className="font-medium">{preview.roleName || t("users.chooseRole")}</span>
        <span className="text-muted-foreground"> · {where}</span>
      </p>
      <p className="mt-1 text-muted-foreground">{actions}</p>
    </div>
  );
}
