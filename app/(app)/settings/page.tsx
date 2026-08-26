"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SelfUpdateSection } from "@/components/settings/self-update-section";

export default function SettingsPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Settings</h1>
      <SelfUpdateSection />
      <Card>
        <CardHeader>
          <CardTitle>General</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>Application name: Proxora</p>
          <p>Sessions use httpOnly cookies. Credentials never leave the server.</p>
          <p>Configure hosts, users and notification channels from the sidebar.</p>
        </CardContent>
      </Card>
    </div>
  );
}
