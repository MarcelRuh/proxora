"use client";

import { PageHeader } from "@/components/layout/page-header";
import { ChangePasswordForm } from "@/components/settings/change-password-form";
import { TotpSection } from "@/components/settings/totp-section";
import { SessionsSection } from "@/components/settings/sessions-section";
import { GuestNetworksSection } from "@/components/settings/guest-networks-section";
import { NotificationsSection } from "@/components/settings/notifications-section";
import { CpuTempSection } from "@/components/settings/cpu-temp-section";
import { DiskAlertsSection } from "@/components/settings/disk-alerts-section";
import { AppearanceSection } from "@/components/settings/appearance-section";
import { useI18n } from "@/components/i18n/locale-provider";

export default function SettingsPage() {
  const { t } = useI18n();
  return (
    <div className="space-y-6">
      <PageHeader kicker={t("settings.kicker")} title={t("settings.title")} />
      <nav className="flex flex-wrap gap-2 text-sm">
        {(
          [
            ["appearance", "appearance.title"],
            ["password", "settings.password"],
            ["totp", "settings.totp"],
            ["sessions", "settings.sessions"],
            ["networks", "settings.networks"],
            ["disk", "settings.diskTitle"],
            ["cpu", "settings.cpuTempTitle"],
            ["webhooks", "settings.notifications"],
          ] as const
        ).map(([id, key]) => (
          <a key={id} href={`#${id}`} className="rounded-[4px] border border-border px-2 py-1 text-muted-foreground hover:text-foreground">
            {t(key)}
          </a>
        ))}
      </nav>
      <div id="appearance"><AppearanceSection /></div>
      <div id="password"><ChangePasswordForm /></div>
      <div id="totp"><TotpSection /></div>
      <div id="sessions"><SessionsSection /></div>
      <div id="networks"><GuestNetworksSection /></div>
      <div id="disk"><DiskAlertsSection /></div>
      <div id="cpu"><CpuTempSection /></div>
      <div id="webhooks" className="space-y-3">
        <h2 className="proxora-title text-2xl">{t("settings.notifications")}</h2>
        <NotificationsSection />
      </div>
    </div>
  );
}
