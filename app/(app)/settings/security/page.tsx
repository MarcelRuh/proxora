"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function SecuritySettingsPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Security</h1>
      <Card>
        <CardHeader>
          <CardTitle>Hardening</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>Passwords are hashed with bcrypt (12 rounds).</p>
          <p>API tokens are encrypted at rest with AES-256-GCM.</p>
          <p>Sessions are random tokens stored as SHA-256 hashes.</p>
          <p>Mutating API calls validate Origin against APP_URL.</p>
          <p>2FA enrollment UI is not in v1 (status is stored on the user). Treat this as coming soon.</p>
        </CardContent>
      </Card>
    </div>
  );
}
