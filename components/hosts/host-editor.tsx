"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input, Label } from "@/components/ui/input";
import { api } from "@/lib/api";
import type { PublicHost } from "@/lib/types";
import { useI18n } from "@/components/i18n/locale-provider";
import { useCan } from "@/components/auth/session-user";

export type HostFormState = {
  name: string;
  url: string;
  authType: "API_TOKEN" | "PASSWORD";
  username: string;
  tokenId: string;
  secret: string;
  allowInsecureTls: boolean;
  notes: string;
};

export const emptyHostForm: HostFormState = {
  name: "",
  url: "https://192.168.1.10:8006",
  authType: "PASSWORD",
  username: "root@pam",
  tokenId: "",
  secret: "",
  allowInsecureTls: true,
  notes: "",
};

export function formFromHost(host: PublicHost): HostFormState {
  return {
    name: host.name,
    url: host.url,
    authType: host.authType,
    username: host.username,
    tokenId: host.tokenId ?? "",
    secret: "",
    allowInsecureTls: host.allowInsecureTls,
    notes: host.notes ?? "",
  };
}

export function HostEditorDialog({
  mode,
  host,
  open,
  onOpenChange,
  onSaved,
}: {
  mode: "create" | "edit";
  host?: PublicHost | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const { t } = useI18n();
  const canUpdate = useCan("hosts.update");
  const canCreds = useCan("hosts.credentials");
  const [form, setForm] = useState<HostFormState>(emptyHostForm);
  const [test, setTest] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const metaLocked = mode === "edit" && !canUpdate;
  const credsLocked = mode === "edit" && !canCreds;

  useEffect(() => {
    if (!open) return;
    setForm(host ? formFromHost(host) : emptyHostForm);
    setTest(null);
  }, [open, host]);

  function setOpen(next: boolean) {
    onOpenChange(next);
  }

  async function save() {
    setBusy(true);
    try {
      if (mode === "create") {
        await api("/api/hosts", { method: "POST", body: JSON.stringify(payload(form, true, { meta: true, creds: true })) });
        toast.success(t("hosts.added"));
      } else if (host) {
        await api(`/api/hosts/${host.id}`, {
          method: "PATCH",
          body: JSON.stringify(
            payload(form, false, { meta: !metaLocked, creds: !credsLocked }),
          ),
        });
        toast.success(t("hosts.updated"));
      }
      onSaved();
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.failed"));
    } finally {
      setBusy(false);
    }
  }

  async function testConnection() {
    try {
      if (mode === "edit" && host && !form.secret) {
        await api(`/api/hosts/${host.id}/test`, { method: "POST" });
        setTest(t("hosts.testOk"));
        return;
      }
      const r = await api<{ ok: boolean; version?: { version: string }; error?: string }>(
        "/api/hosts/test",
        { method: "POST", body: JSON.stringify(payload(form, true, { meta: true, creds: true })) },
      );
      setTest(r.ok ? `${t("hosts.testOk")} · Proxmox ${r.version?.version}` : r.error ?? t("common.failed"));
    } catch (e) {
      setTest(e instanceof Error ? e.message : t("common.failed"));
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{mode === "create" ? t("hosts.addTitle") : t("hosts.editTitle", { name: host?.name ?? "" })}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <Field label={t("create.name")} value={form.name} disabled={metaLocked} onChange={(name) => setForm({ ...form, name })} />
          <Field label={t("create.host")} value={form.url} disabled={metaLocked} onChange={(url) => setForm({ ...form, url })} />
          <Field label={t("hosts.notes")} value={form.notes} disabled={metaLocked} onChange={(notes) => setForm({ ...form, notes })} />
          <div className="space-y-1">
            <Label>{t("hosts.auth")}</Label>
            <select
              className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              value={form.authType}
              disabled={credsLocked}
              onChange={(e) => {
                const authType = e.target.value as HostFormState["authType"];
                setForm({
                  ...form,
                  authType,
                  tokenId: authType === "API_TOKEN" ? form.tokenId || "manager" : "",
                  username: form.username || "root@pam",
                });
              }}
            >
              <option value="PASSWORD">{t("hosts.authPassword")}</option>
              <option value="API_TOKEN">{t("hosts.authToken")}</option>
            </select>
          </div>
          <Field
            label={t("hosts.user")}
            value={form.username}
            disabled={credsLocked}
            onChange={(username) => setForm({ ...form, username })}
            placeholder="root@pam"
          />
          {form.authType === "API_TOKEN" ? (
            <Field label={t("hosts.tokenId")} value={form.tokenId} disabled={credsLocked} onChange={(tokenId) => setForm({ ...form, tokenId })} />
          ) : null}
          <Field
            label={form.authType === "PASSWORD" ? t("create.password") : t("hosts.tokenSecret")}
            type="password"
            value={form.secret}
            disabled={credsLocked}
            onChange={(secret) => setForm({ ...form, secret })}
            placeholder={mode === "edit" ? t("hosts.secretKeep") : undefined}
          />
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.allowInsecureTls}
              disabled={metaLocked}
              onChange={(e) => setForm({ ...form, allowInsecureTls: e.target.checked })}
            />
            {t("hosts.allowTls")}
          </label>
          {test ? <p className="text-sm text-muted-foreground">{test}</p> : null}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => void testConnection()}>
              {t("hosts.testConnection")}
            </Button>
            <Button onClick={() => void save()} disabled={busy || (mode === "edit" && metaLocked && credsLocked)}>
              {t("hosts.saveHost")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function payload(
  form: HostFormState,
  requireSecret: boolean,
  parts: { meta: boolean; creds: boolean },
) {
  const body: Record<string, unknown> = {};
  if (parts.meta) {
    body.name = form.name;
    body.url = form.url;
    body.allowInsecureTls = form.allowInsecureTls;
    body.notes = form.notes || null;
  }
  if (parts.creds) {
    body.authType = form.authType;
    body.username = form.username;
    body.tokenId = form.authType === "API_TOKEN" ? form.tokenId : null;
    if (requireSecret || form.secret) body.secret = form.secret;
  }
  return body;
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      <Input type={type} value={value} placeholder={placeholder} disabled={disabled} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}
