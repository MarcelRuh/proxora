"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";
import { api } from "@/lib/api";
import { useI18n } from "@/components/i18n/locale-provider";

export function ChangePasswordForm() {
  const { t } = useI18n();
  const [currentPassword, setCurrent] = useState("");
  const [newPassword, setNew] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (newPassword !== confirm) {
      toast.error(t("settings.passwordMismatch"));
      return;
    }
    setBusy(true);
    try {
      await api("/api/account/password", {
        method: "POST",
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      toast.success(t("settings.passwordSaved"));
      setCurrent("");
      setNew("");
      setConfirm("");
    } catch (err) {
      const message = err instanceof Error ? err.message : "";
      toast.error(message === "CURRENT_PASSWORD_INVALID" ? t("password.wrong") : message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("settings.password")}</CardTitle>
      </CardHeader>
      <CardContent>
        <form className="grid max-w-md gap-3" onSubmit={submit}>
          <div className="space-y-1">
            <Label>{t("settings.currentPassword")}</Label>
            <Input type="password" autoComplete="current-password" value={currentPassword} onChange={(e) => setCurrent(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>{t("settings.newPassword")}</Label>
            <Input type="password" autoComplete="new-password" value={newPassword} onChange={(e) => setNew(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>{t("settings.confirmPassword")}</Label>
            <Input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </div>
          <p className="text-xs text-muted-foreground">{t("settings.passwordHint")}</p>
          <Button type="submit" disabled={busy || newPassword.length < 10 || !currentPassword}>
            {t("common.save")}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
