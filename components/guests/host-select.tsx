"use client";

import type { PublicHost } from "@/lib/types";
import { useI18n } from "@/components/i18n/locale-provider";

const selectClass =
  "mt-1 h-9 w-full rounded-[4px] border border-input bg-white/[0.03] px-2 text-sm";

export function hostAllowsCreate(host: PublicHost): boolean {
  if (host.origin !== "PEER") return true;
  return host.shareLevel === "create";
}

export function HostSelect({
  hosts,
  value,
  onChange,
  createOnly = false,
}: {
  hosts: PublicHost[];
  value: string;
  onChange: (hostId: string) => void;
  createOnly?: boolean;
}) {
  const { t } = useI18n();
  const list = createOnly ? hosts.filter(hostAllowsCreate) : hosts;
  const local = list.filter((h) => h.origin !== "PEER");
  const remoteGroups = new Map<string, PublicHost[]>();
  for (const host of list.filter((h) => h.origin === "PEER")) {
    const key = host.peerName || t("peers.unknown");
    const bucket = remoteGroups.get(key) ?? [];
    bucket.push(host);
    remoteGroups.set(key, bucket);
  }

  return (
    <select className={selectClass} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{t("common.chooseHost")}</option>
      {local.length ? (
        <optgroup label={t("peers.localGroup")}>
          {local.map((h) => (
            <option key={h.id} value={h.id}>
              {h.name}
            </option>
          ))}
        </optgroup>
      ) : null}
      {[...remoteGroups.entries()].map(([name, group]) => (
        <optgroup key={name} label={t("peers.peerGroup", { name })}>
          {group.map((h) => (
            <option key={h.id} value={h.id}>
              {h.name}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}
