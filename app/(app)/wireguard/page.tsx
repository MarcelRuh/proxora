"use client";

import { PageHeader } from "@/components/layout/page-header";
import { WireguardSection } from "@/components/settings/wireguard-section";
import { useI18n } from "@/components/i18n/locale-provider";

export default function WireguardPage() {
  const { t } = useI18n();
  return (
    <div className="space-y-6">
      <PageHeader kicker={t("peers.kicker")} title={t("peers.title")} description={t("peers.body")} />
      <WireguardSection />
    </div>
  );
}
