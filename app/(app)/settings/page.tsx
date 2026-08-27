"use client";

import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/layout/page-header";

export default function SettingsPage() {
  return (
    <div className="space-y-4">
      <PageHeader kicker="System" title="Einstellungen" />
      <Card>
        <CardHeader>
          <CardTitle className="proxora-section">Allgemein</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>Anwendungsname: Proxora</p>
          <p>Sessions nutzen httpOnly-Cookies. Zugangsdaten bleiben auf dem Server.</p>
          <p>
            Proxora-Updates unter{" "}
            <Link className="underline" href="/proxora">
              Einstellungen → Proxora
            </Link>
            .
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
