"use client";

import { PageHeader } from "@/components/layout/page-header";
import { SelfUpdateSection } from "@/components/settings/self-update-section";
import { useI18n } from "@/components/i18n/locale-provider";

export default function ProxoraPage() {
  const { t } = useI18n();
  return (
    <div className="space-y-6">
      <PageHeader kicker={t("proxora.kicker")} title={t("proxora.title")} description={t("proxora.description")} />
      <SelfUpdateSection />
    </div>
  );
}
