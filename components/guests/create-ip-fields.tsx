"use client";

import { useEffect, useRef } from "react";
import {
  DEFAULT_GUEST_NETWORK,
  GUEST_IP_NETWORKS,
  guestCidrFromVmid,
  guestGateway,
  ipv4Host,
  shouldSyncGuestIp,
  type GuestIpNetwork,
} from "@/lib/create-ip";
import type { LxcIpMode } from "@/lib/lxc-net";
import { Input, Label } from "@/components/ui/input";
import { useI18n } from "@/components/i18n/locale-provider";

const selectClass =
  "mt-1 h-9 w-full rounded-[4px] border border-input bg-white/[0.03] px-2 text-sm";

export type GuestIpFieldsValue = {
  ipMode: LxcIpMode;
  network: string;
  cidr: string;
  gateway: string;
};

export function ipFieldsFromVmid(
  network: string,
  vmid: number,
  networks: GuestIpNetwork[] = GUEST_IP_NETWORKS,
): Pick<GuestIpFieldsValue, "cidr" | "gateway"> {
  return {
    cidr: guestCidrFromVmid(network, vmid, networks),
    gateway: guestGateway(network, networks),
  };
}

export function CreateIpFields({
  value,
  vmid,
  onChange,
  networks = GUEST_IP_NETWORKS,
  usedIps = [],
  hint,
}: {
  value: GuestIpFieldsValue;
  vmid: number;
  onChange: (next: GuestIpFieldsValue) => void;
  networks?: GuestIpNetwork[];
  usedIps?: string[];
  hint?: string;
}) {
  const { t } = useI18n();
  const list = networks.length ? networks : GUEST_IP_NETWORKS;
  const host = ipv4Host(value.cidr);
  const collision = value.ipMode === "static" && Boolean(host && usedIps.includes(host));
  const highId = vmid > 254;
  const valueRef = useRef(value);
  valueRef.current = value;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const listRef = useRef(list);
  listRef.current = list;
  const prevVmid = useRef<number | null>(null);

  useEffect(() => {
    const current = valueRef.current;
    if (current.ipMode !== "static") {
      prevVmid.current = vmid;
      return;
    }
    const nets = listRef.current;
    const prev = prevVmid.current;
    prevVmid.current = vmid;
    if (prev === vmid) return;
    const from = prev != null && prev > 0 ? prev : vmid;
    if (current.cidr.trim() && !shouldSyncGuestIp(current.cidr, current.network, from, nets)) return;
    const next = ipFieldsFromVmid(current.network, vmid, nets);
    if (next.cidr === current.cidr && next.gateway === current.gateway) return;
    onChangeRef.current({ ...current, ...next });
  }, [vmid]);

  function setMode(ipMode: LxcIpMode) {
    if (ipMode === "static") {
      const network = value.network || list[0]?.id || DEFAULT_GUEST_NETWORK;
      onChange({ ipMode, network, ...ipFieldsFromVmid(network, vmid, list) });
      return;
    }
    onChange({ ...value, ipMode });
  }

  function setNetwork(network: string) {
    onChange({ ...value, ipMode: "static", network, ...ipFieldsFromVmid(network, vmid, list) });
  }

  return (
    <>
      <label className="text-sm">
        {t("create.ipv4")}
        <select className={selectClass} value={value.ipMode} onChange={(e) => setMode(e.target.value as LxcIpMode)}>
          <option value="dhcp">{t("create.dhcp")}</option>
          <option value="static">{t("create.static")}</option>
        </select>
      </label>
      {value.ipMode === "static" ? (
        <>
          <label className="text-sm">
            {t("create.network")}
            <select className={selectClass} value={value.network} onChange={(e) => setNetwork(e.target.value)}>
              {list.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.id}/{n.prefix}
                </option>
              ))}
            </select>
          </label>
          <div className="space-y-1">
            <Label>{t("create.address")}</Label>
            <Input value={value.cidr} onChange={(e) => onChange({ ...value, cidr: e.target.value })} />
            {highId ? <p className="text-xs text-warning">{t("create.vmidHigh")}</p> : null}
            {collision ? <p className="text-xs text-destructive">{t("create.ipTaken", { ip: host ?? "" })}</p> : null}
          </div>
          <div className="space-y-1">
            <Label>{t("create.gateway")}</Label>
            <Input value={value.gateway} onChange={(e) => onChange({ ...value, gateway: e.target.value })} />
          </div>
        </>
      ) : null}
      {hint ? <p className="text-xs text-muted-foreground md:col-span-2">{hint}</p> : null}
    </>
  );
}

export function ipCollision(cidr: string, usedIps: string[]): boolean {
  const host = ipv4Host(cidr);
  return Boolean(host && usedIps.includes(host));
}
