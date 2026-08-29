"use client";

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ConfirmAction } from "@/components/confirm-action";
import { api } from "@/lib/api";
import { bytesToSize } from "@/lib/utils";
import { useI18n } from "@/components/i18n/locale-provider";
import { useCan } from "@/components/auth/session-user";
import { formatVolumeUsers } from "@/lib/volume-usage";
import {
  filterStorageContent,
  storageContentDeletePermission,
  type StorageContentItem,
  type StorageContentKind,
} from "@/lib/storage-content";

const selectClass = "h-9 rounded-[4px] border border-input bg-white/[0.03] px-2 text-sm";

type Props = {
  hostId: string;
  node: string;
  storage: string;
  onClose: () => void;
};

export function StorageContentPanel({ hostId, node, storage, onClose }: Props) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const canStorageDelete = useCan("storage.delete");
  const canBackupDelete = useCan("backup.delete");
  const [query, setQuery] = useState("");
  const [content, setContent] = useState<StorageContentKind | "all" | "unused">("all");

  const { data, isLoading, error } = useQuery({
    queryKey: ["storage-content", hostId, node, storage],
    queryFn: () =>
      api<{ items: StorageContentItem[] }>(
        `/api/hosts/${hostId}/storage/content?node=${encodeURIComponent(node)}&storage=${encodeURIComponent(storage)}`,
      ),
  });

  const items = useMemo(
    () => filterStorageContent(data?.items ?? [], { query, content }),
    [data?.items, query, content],
  );

  function canDelete(item: StorageContentItem): boolean {
    const needed = storageContentDeletePermission(item.content);
    return needed === "backup.delete" ? canBackupDelete : canStorageDelete;
  }

  async function remove(item: StorageContentItem) {
    await api(`/api/hosts/${hostId}/storage/content`, {
      method: "POST",
      body: JSON.stringify({ action: "delete", node, volid: item.volid }),
    });
    toast.success(t("storage.deleted"));
    void qc.invalidateQueries({ queryKey: ["storage-content", hostId, node, storage] });
    void qc.invalidateQueries({ queryKey: ["storage"] });
  }

  function contentLabel(kind: StorageContentKind) {
    switch (kind) {
      case "iso":
        return t("storage.filterIso");
      case "vztmpl":
        return t("storage.filterTemplate");
      case "images":
        return t("storage.filterImages");
      case "rootdir":
        return t("storage.filterRootdir");
      case "backup":
        return t("storage.filterBackup");
      case "snippets":
        return t("storage.filterSnippets");
      default:
        return kind;
    }
  }

  function usageBadge(item: StorageContentItem) {
    if (item.usage === "attached") return <Badge variant="warning">{t("storage.attached")}</Badge>;
    if (item.usage === "unused") return <Badge variant="success">{t("storage.unused")}</Badge>;
    return <Badge variant="muted">{t("storage.unreferenced")}</Badge>;
  }

  function guestLabel(item: StorageContentItem) {
    if (!item.vmid) return "—";
    const kind = item.guestKind === "lxc" ? "CT" : item.guestKind === "vm" ? "VM" : "";
    const name = item.guestName ? ` ${item.guestName}` : "";
    return `${kind ? `${kind} ` : ""}${item.vmid}${name}`.trim();
  }

  return (
    <div className="mt-4 space-y-3 rounded-[4px] border border-border bg-white/[0.02] p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium">
          {t("storage.browseTitle", { storage, node })}
        </p>
        <Button size="sm" variant="outline" onClick={onClose}>
          {t("storage.closeContent")}
        </Button>
      </div>
      <div className="flex flex-wrap gap-2">
        <Input
          className="max-w-xs"
          placeholder={t("storage.search")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select
          className={selectClass}
          value={content}
          onChange={(e) => setContent(e.target.value as StorageContentKind | "all" | "unused")}
        >
          <option value="all">{t("storage.filterAll")}</option>
          <option value="iso">{t("storage.filterIso")}</option>
          <option value="vztmpl">{t("storage.filterTemplate")}</option>
          <option value="images">{t("storage.filterImages")}</option>
          <option value="rootdir">{t("storage.filterRootdir")}</option>
          <option value="backup">{t("storage.filterBackup")}</option>
          <option value="snippets">{t("storage.filterSnippets")}</option>
          <option value="unused">{t("storage.filterUnused")}</option>
        </select>
      </div>
      {error ? (
        <p className="text-sm text-destructive">{t("storage.loadContentError")}</p>
      ) : isLoading ? (
        <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("storage.contentEmpty")}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="font-[family-name:var(--font-display)] text-left text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              <tr>
                <th className="py-2 font-medium">{t("storage.file")}</th>
                <th className="font-medium">{t("storage.contentType")}</th>
                <th className="font-medium">{t("storage.guest")}</th>
                <th className="font-medium">{t("storage.usageState")}</th>
                <th className="font-medium">{t("storage.size")}</th>
                <th className="font-medium">{t("table.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const guests = item.vmid
                  ? [{ kind: item.guestKind ?? "vm", vmid: item.vmid, name: item.guestName ?? "", node }]
                  : [];
                const inUse = item.usage === "attached";
                return (
                  <tr key={item.volid} className="border-t border-border">
                    <td className="py-2">
                      <div className="max-w-md truncate">{item.filename}</div>
                      <p className="max-w-md truncate text-[11px] text-muted-foreground">{item.volid}</p>
                    </td>
                    <td>{contentLabel(item.content)}</td>
                    <td>{guestLabel(item)}</td>
                    <td>{usageBadge(item)}</td>
                    <td>{bytesToSize(item.size)}</td>
                    <td>
                      {canDelete(item) ? (
                        <ConfirmAction
                          title={t("storage.deleteTitle", { name: item.filename })}
                          description={
                            inUse
                              ? t("storage.deleteInUse", {
                                  name: item.filename,
                                  guests: formatVolumeUsers(guests),
                                })
                              : t("storage.deleteBody")
                          }
                          actionLabel={t("storage.delete")}
                          destructive
                          onConfirm={() => remove(item)}
                        >
                          <Button size="sm" variant="destructive">
                            {t("storage.delete")}
                          </Button>
                        </ConfirmAction>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
