"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/layout/page-header";

export default function SecuritySettingsPage() {
  return (
    <div className="space-y-4">
      <PageHeader kicker="System" title="Sicherheit" />
      <Card>
        <CardHeader>
          <CardTitle>Hardening</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>Passwords are hashed with bcrypt (12 rounds).</p>
          <p>API tokens are encrypted at rest with AES-256-GCM.</p>
          <p>Sessions are random tokens stored as SHA-256 hashes.</p>
          <p>Mutating API calls validate Origin against the request Host and APP_URL.</p>
          <p>2FA enrollment UI is not in v1 (status is stored on the user). Treat this as coming soon.</p>
        </CardContent>
      </Card>
    </div>
  );
}
