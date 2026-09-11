"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { api, ApiRequestError } from "@/lib/api";
import { UiAtmosphere } from "@/components/layout/ui-atmosphere";
import { APP_NAME } from "@/lib/version";
import { useI18n } from "@/components/i18n/locale-provider";
import { LocaleSwitch } from "@/components/i18n/locale-switch";
import { UiThemeSelect } from "@/components/theme/ui-theme-select";
import { resolvePostLoginPath } from "@/lib/home-path";
import type { SessionUser } from "@/lib/types";

export function LoginForm({ next }: { next: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [ticket, setTicket] = useState<string | null>(null);
  const [totp, setTotp] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function loginError(err: unknown): string {
    if (err instanceof ApiRequestError) {
      if (err.code === "INVALID_TOTP") return t("login.totpInvalid");
      if (err.code === "RATE_LIMITED") return t("login.rateLimited");
      if (err.code === "INVALID_CREDENTIALS" || err.code === "VALIDATION_ERROR") return t("login.failed");
    }
    return err instanceof Error ? err.message : t("login.failed");
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const payload = ticket ? { ticket, totp } : { username, password };
      const res = await api<{ totpRequired?: boolean; ticket?: string; user?: SessionUser }>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      if (res.totpRequired && res.ticket) {
        setTicket(res.ticket);
        setTotp("");
        return;
      }
      router.push(res.user ? resolvePostLoginPath(res.user, next) : next);
      router.refresh();
    } catch (err) {
      setError(loginError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center p-4">
      <UiAtmosphere />
      <Card className="relative z-10 w-full max-w-md">
        <CardHeader className="items-center text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/proxora-logo.jpg" alt={APP_NAME} className="mx-auto mb-2 w-56 object-contain" />
          <CardDescription>{ticket ? t("login.totpSubtitle") : t("login.subtitle")}</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={onSubmit}>
            {ticket ? (
              <div className="space-y-1.5">
                <Label htmlFor="totp">{t("login.totp")}</Label>
                <Input
                  id="totp"
                  autoComplete="one-time-code"
                  value={totp}
                  onChange={(e) => setTotp(e.target.value)}
                  autoFocus
                />
                <p className="text-xs text-muted-foreground">{t("login.recoveryHint")}</p>
              </div>
            ) : (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="username">{t("login.username")}</Label>
                  <Input
                    id="username"
                    autoComplete="username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    autoFocus
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="password">{t("login.password")}</Label>
                  <Input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
                </div>
              </>
            )}
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            <Button className="w-full uppercase tracking-wider" disabled={busy || Boolean(ticket && totp.replace(/\s/g, "").length < 6)}>
              {busy ? t("login.busy") : ticket ? t("login.totpSubmit") : t("login.submit")}
            </Button>
            {ticket ? (
              <button
                type="button"
                className="w-full text-xs text-muted-foreground hover:underline"
                onClick={() => {
                  setTicket(null);
                  setTotp("");
                  setError(null);
                }}
              >
                {t("login.back")}
              </button>
            ) : null}
            <div className="grid gap-2">
              <UiThemeSelect />
              <LocaleSwitch className="justify-center" />
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
