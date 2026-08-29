"use client";

import { PageHeader } from "@/components/layout/page-header";
import { ChangePasswordForm } from "@/components/settings/change-password-form";
import { TotpSection } from "@/components/settings/totp-section";
import { GuestNetworksSection } from "@/components/settings/guest-networks-section";
import { NotificationsSection } from "@/components/settings/notifications-section";
import { DiskAlertsSection } from "@/components/settings/disk-alerts-section";
import { useI18n } from "@/components/i18n/locale-provider";

export default function SettingsPage() {
  const { t } = useI18n();
  return (
    <div className="space-y-6">
      <PageHeader kicker={t("settings.kicker")} title={t("settings.title")} />
      <ChangePasswordForm />
      <TotpSection />
      <GuestNetworksSection />
      <DiskAlertsSection />
      <div id="meldungen" className="space-y-3">
        <h2 className="proxora-title text-2xl">{t("settings.notifications")}</h2>
        <NotificationsSection />
      </div>
    </div>
  );
}
