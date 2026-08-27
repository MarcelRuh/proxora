"use client";

import { SelfUpdateSection } from "@/components/settings/self-update-section";
import { PageHeader } from "@/components/layout/page-header";

export default function ProxoraUpdatePage() {
  return (
    <div className="space-y-4">
      <PageHeader kicker="System" title="Proxora" description="Self-Update dieser Installation von GitHub." />
      <SelfUpdateSection />
    </div>
  );
}
