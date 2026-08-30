"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { GuestTable } from "@/components/guests/guest-table";
import { dashboardGuests, useDashboard } from "@/components/dashboard/use-dashboard";
import { PageHeader } from "@/components/layout/page-header";
import { QueryGate } from "@/components/layout/query-gate";
import { useI18n } from "@/components/i18n/locale-provider";
import { useCan } from "@/components/auth/session-user";

export default function ContainersPage() {
  const { t } = useI18n();
  const canCreate = useCan("lxc.create");
  const { data, isLoading, error, refetch } = useDashboard();

  return (
    <div className="space-y-4">
      <PageHeader
        kicker={t("vms.kicker")}
        title={t("lxc.title")}
        description={t("lxc.description")}
        actions={
          canCreate ? (
            <Button asChild>
              <Link href="/containers/create">{t("lxc.create")}</Link>
            </Button>
          ) : undefined
        }
      />
      <QueryGate isLoading={false} error={error} onRetry={() => void refetch()}>
        <GuestTable kind="lxc" items={dashboardGuests(data, "lxc")} loading={isLoading} />
      </QueryGate>
    </div>
  );
}
