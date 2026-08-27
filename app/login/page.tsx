"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { api } from "@/lib/api";
import { NeonAtmosphere } from "@/components/layout/neon-atmosphere";
import { BrandMark } from "@/components/layout/brand-mark";
import { APP_NAME } from "@/lib/version";
import { useI18n } from "@/components/i18n/locale-provider";

export default function LoginPage() {
  const { t, locale, setLocale } = useI18n();
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [ticket, setTicket] = useState<string | null>(null);
  const [totp, setTotp] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const payload = ticket ? { ticket, totp } : { username, password };
      const res = await api<{ totpRequired?: boolean; ticket?: string }>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      if (res.totpRequired && res.ticket) {
        setTicket(res.ticket);
        setTotp("");
        return;
      }
      router.push("/dashboard");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("login.failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center p-4">
      <NeonAtmosphere />
      <Card className="relative z-10 w-full max-w-md">
        <CardHeader>
          <BrandMark className="mb-3 h-12 w-12 drop-shadow-[0_0_16px_rgba(255,0,110,0.35)]" />
          <CardTitle className="proxora-logo text-2xl">{APP_NAME.toUpperCase()}</CardTitle>
          <CardDescription>{ticket ? t("login.totpSubtitle") : t("login.subtitle")}</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={onSubmit}>
            {ticket ? (
              <div className="space-y-1.5">
                <Label htmlFor="totp">{t("login.totp")}</Label>
                <Input
                  id="totp"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={totp}
                  onChange={(e) => setTotp(e.target.value)}
                  autoFocus
                />
              </div>
            ) : (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="username">{t("login.username")}</Label>
                  <Input id="username" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} />
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
            <div className="flex justify-center gap-2 text-xs font-semibold uppercase tracking-wider">
              <button type="button" className={locale === "de" ? "text-primary" : "text-muted-foreground"} onClick={() => setLocale("de")}>
                DE
              </button>
              <span className="text-muted-foreground">/</span>
              <button type="button" className={locale === "en" ? "text-primary" : "text-muted-foreground"} onClick={() => setLocale("en")}>
                EN
              </button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
