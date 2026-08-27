"use client";

import {
  DEFAULT_GUEST_NETWORK,
  GUEST_IP_NETWORKS,
  guestCidrFromVmid,
  guestGateway,
  type GuestIpNetworkId,
} from "@/lib/create-ip";
import type { LxcIpMode } from "@/lib/lxc-net";
import { Input, Label } from "@/components/ui/input";
import { useI18n } from "@/components/i18n/locale-provider";

const selectClass =
  "mt-1 h-9 w-full rounded-[4px] border border-input bg-white/[0.03] px-2 text-sm";

export type GuestIpFieldsValue = {
  ipMode: LxcIpMode;
  network: GuestIpNetworkId;
  cidr: string;
  gateway: string;
};

export function ipFieldsFromVmid(network: GuestIpNetworkId, vmid: number): Pick<GuestIpFieldsValue, "cidr" | "gateway"> {
  return {
    cidr: guestCidrFromVmid(network, vmid),
    gateway: guestGateway(network),
  };
}

export function CreateIpFields({
  value,
  vmid,
  onChange,
}: {
  value: GuestIpFieldsValue;
  vmid: number;
  onChange: (next: GuestIpFieldsValue) => void;
}) {
  const { t } = useI18n();

  function setMode(ipMode: LxcIpMode) {
    if (ipMode === "static") {
      onChange({ ipMode, network: value.network || DEFAULT_GUEST_NETWORK, ...ipFieldsFromVmid(value.network || DEFAULT_GUEST_NETWORK, vmid) });
      return;
    }
    onChange({ ...value, ipMode });
  }

  function setNetwork(network: GuestIpNetworkId) {
    onChange({ ...value, ipMode: "static", network, ...ipFieldsFromVmid(network, vmid) });
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
            <select
              className={selectClass}
              value={value.network}
              onChange={(e) => setNetwork(e.target.value as GuestIpNetworkId)}
            >
              {GUEST_IP_NETWORKS.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.id}/{n.prefix}
                </option>
              ))}
            </select>
          </label>
          <div className="space-y-1">
            <Label>{t("create.address")}</Label>
            <Input value={value.cidr} onChange={(e) => onChange({ ...value, cidr: e.target.value })} />
          </div>
          <div className="space-y-1">
            <Label>{t("create.gateway")}</Label>
            <Input value={value.gateway} onChange={(e) => onChange({ ...value, gateway: e.target.value })} />
          </div>
        </>
      ) : null}
    </>
  );
}
