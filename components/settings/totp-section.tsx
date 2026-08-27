"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";
import { api } from "@/lib/api";
import { useI18n } from "@/components/i18n/locale-provider";
import { useQuery, useQueryClient } from "@tanstack/react-query";

type TotpStatus = { enabled: boolean };
type TotpBegin = { secret: string; otpauth: string; qr: string };

export function TotpSection() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["account-totp"],
    queryFn: () => api<TotpStatus>("/api/account/totp"),
  });
  const [pending, setPending] = useState<TotpBegin | null>(null);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  async function begin() {
    setBusy(true);
    try {
      const res = await api<TotpBegin>("/api/account/totp", { method: "POST", body: JSON.stringify({ action: "begin" }) });
      setPending(res);
      setCode("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.failed"));
    } finally {
      setBusy(false);
    }
  }

  async function enable() {
    if (!pending) return;
    setBusy(true);
    try {
      await api("/api/account/totp", {
        method: "POST",
        body: JSON.stringify({ action: "enable", secret: pending.secret, code }),
      });
      toast.success(t("settings.totpEnabled"));
      setPending(null);
      setCode("");
      await qc.invalidateQueries({ queryKey: ["account-totp"] });
    } catch (err) {
      const message = err instanceof Error ? err.message : "";
      toast.error(message === "INVALID_TOTP" ? t("login.totpInvalid") : message);
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    try {
      await api("/api/account/totp", {
        method: "POST",
        body: JSON.stringify({ action: "disable", code, password }),
      });
      toast.success(t("settings.totpDisabled"));
      setCode("");
      setPassword("");
      await qc.invalidateQueries({ queryKey: ["account-totp"] });
    } catch (err) {
      const message = err instanceof Error ? err.message : "";
      toast.error(
        message === "INVALID_TOTP"
          ? t("login.totpInvalid")
          : message === "CURRENT_PASSWORD_INVALID"
            ? t("password.wrong")
            : message,
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("settings.totp")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-muted-foreground">{t("settings.totpHint")}</p>
        {data?.enabled ? (
          <form
            className="grid max-w-md gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              void disable();
            }}
          >
            <p className="text-success">{t("settings.totpOn")}</p>
            <div className="space-y-1">
              <Label>{t("login.totp")}</Label>
              <Input inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>{t("settings.currentPassword")}</Label>
              <Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            <Button type="submit" variant="destructive" disabled={busy || code.replace(/\s/g, "").length < 6 || !password}>
              {t("settings.totpDisable")}
            </Button>
          </form>
        ) : pending ? (
          <div className="grid max-w-md gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={pending.qr} alt="TOTP QR" className="h-48 w-48 rounded-[4px] bg-white p-2" />
            <p className="break-all font-mono text-xs text-muted-foreground">{pending.secret}</p>
            <div className="space-y-1">
              <Label>{t("login.totp")}</Label>
              <Input inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} />
            </div>
            <div className="flex gap-2">
              <Button type="button" onClick={() => void enable()} disabled={busy || code.replace(/\s/g, "").length < 6}>
                {t("settings.totpConfirm")}
              </Button>
              <Button type="button" variant="outline" onClick={() => setPending(null)}>
                {t("common.cancel")}
              </Button>
            </div>
          </div>
        ) : (
          <Button type="button" onClick={() => void begin()} disabled={busy}>
            {t("settings.totpSetup")}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
