"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { GuestTable } from "@/components/guests/guest-table";
import { dashboardGuests, useDashboard } from "@/components/dashboard/use-dashboard";
import { PageHeader } from "@/components/layout/page-header";
import { useI18n } from "@/components/i18n/locale-provider";
import { useCan } from "@/components/auth/session-user";

export default function VmsPage() {
  const { t } = useI18n();
  const canCreate = useCan("vm.create");
  const { data } = useDashboard();

  return (
    <div className="space-y-4">
      <PageHeader
        kicker={t("vms.kicker")}
        title={t("vms.title")}
        description={t("vms.description")}
        actions={
          canCreate ? (
            <Button asChild>
              <Link href="/vms/create">{t("vms.create")}</Link>
            </Button>
          ) : undefined
        }
      />
      <GuestTable kind="vm" items={dashboardGuests(data, "vm")} />
    </div>
  );
}
