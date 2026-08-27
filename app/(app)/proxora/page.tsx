"use client";

import { SelfUpdateSection } from "@/components/settings/self-update-section";

export default function ProxoraUpdatePage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Proxora</h1>
        <p className="text-sm text-muted-foreground">Self-Update dieser Installation von GitHub.</p>
      </div>
      <SelfUpdateSection />
    </div>
  );
}
