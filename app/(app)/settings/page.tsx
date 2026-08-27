"use client";

import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function SettingsPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Settings</h1>
      <Card>
        <CardHeader>
          <CardTitle>General</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>Application name: Proxora</p>
          <p>Sessions use httpOnly cookies. Credentials never leave the server.</p>
          <p>
            Proxora-Updates unter{" "}
            <Link className="underline" href="/proxora">
              Settings → Proxora
            </Link>
            .
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
