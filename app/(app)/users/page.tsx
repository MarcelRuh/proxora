"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input, Label } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ConfirmAction } from "@/components/confirm-action";
import { UserScopeFields } from "@/components/access/user-scope-fields";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/layout/page-header";
import { useI18n } from "@/components/i18n/locale-provider";
import { useCan } from "@/components/auth/session-user";
import type { GuestScope } from "@/lib/guest-scope";

type UserRow = {
  id: string;
  username: string;
  email: string;
  status: string;
  lastLoginAt: string | null;
  createdAt: string;
  totpEnabled: boolean;
  role: { name: string; id: string };
  hostIds: string[];
  guests: GuestScope[];
};

type RoleRow = { id: string; name: string; slug: string };

const emptyForm = {
  username: "",
  email: "",
  password: "",
  roleId: "",
  hostIds: [] as string[],
  guests: [] as GuestScope[],
};

export default function UsersPage() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const canCreate = useCan("users.create");
  const canUpdate = useCan("users.update");
  const canDelete = useCan("users.delete");
  const { data } = useQuery({ queryKey: ["users"], queryFn: () => api<{ users: UserRow[] }>("/api/users") });
  const { data: roles } = useQuery({ queryKey: ["roles"], queryFn: () => api<{ roles: RoleRow[] }>("/api/roles") });
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<UserRow | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [editForm, setEditForm] = useState({
    roleId: "",
    status: "ACTIVE",
    hostIds: [] as string[],
    guests: [] as GuestScope[],
  });

  const create = useMutation({
    mutationFn: () => api("/api/users", { method: "POST", body: JSON.stringify(form) }),
    onSuccess: () => {
      toast.success(t("users.created"));
      setOpen(false);
      setForm(emptyForm);
      void qc.invalidateQueries({ queryKey: ["users"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const save = useMutation({
    mutationFn: () =>
      api(`/api/users/${editing!.id}`, {
        method: "PATCH",
        body: JSON.stringify(editForm),
      }),
    onSuccess: () => {
      toast.success(t("users.updated"));
      setEditing(null);
      void qc.invalidateQueries({ queryKey: ["users"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-4">
      <PageHeader
        kicker={t("page.access")}
        title={t("users.title")}
        actions={
          canCreate ? (
            <Button
              onClick={() => {
                setForm(emptyForm);
                setOpen(true);
              }}
            >
              {t("users.add")}
            </Button>
          ) : null
        }
      />
      <Card>
        <CardHeader>
          <CardTitle>{t("users.accounts")}</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="py-2">{t("login.username")}</th>
                <th>Email</th>
                <th>{t("users.role")}</th>
                <th>{t("table.status")}</th>
                <th>2FA</th>
                <th>{t("users.scope")}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(data?.users ?? []).map((u) => (
                <tr key={u.id} className="border-t border-border">
                  <td className="py-2">{u.username}</td>
                  <td>{u.email}</td>
                  <td>{u.role.name}</td>
                  <td>
                    <Badge variant={u.status === "ACTIVE" ? "success" : "muted"}>{u.status}</Badge>
                  </td>
                  <td>{u.totpEnabled ? "on" : "off"}</td>
                  <td className="text-xs text-muted-foreground">
                    {u.hostIds.length === 0 && (u.guests?.length ?? 0) === 0
                      ? t("users.allHosts")
                      : t("users.scopeSummary", { hosts: u.hostIds.length, guests: u.guests?.length ?? 0 })}
                  </td>
                  <td className="text-right">
                    <div className="flex justify-end gap-1">
                      {canUpdate ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setEditing(u);
                            setEditForm({
                              roleId: u.role.id,
                              status: u.status,
                              hostIds: u.hostIds ?? [],
                              guests: u.guests ?? [],
                            });
                          }}
                        >
                          {t("roles.edit")}
                        </Button>
                      ) : null}
                      {canDelete ? (
                        <ConfirmAction
                          title={t("users.deleteTitle", { name: u.username })}
                          description={t("users.deleteBody")}
                          actionLabel={t("guest.delete")}
                          destructive
                          onConfirm={async () => {
                            await api(`/api/users/${u.id}`, { method: "DELETE" });
                            toast.success(t("users.deleted"));
                            void qc.invalidateQueries({ queryKey: ["users"] });
                          }}
                        >
                          <Button size="sm" variant="destructive">
                            {t("guest.delete")}
                          </Button>
                        </ConfirmAction>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("users.add")}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <Field label={t("login.username")} value={form.username} onChange={(username) => setForm({ ...form, username })} />
            <Field label="Email" value={form.email} onChange={(email) => setForm({ ...form, email })} />
            <Field
              label={t("login.password")}
              type="password"
              value={form.password}
              onChange={(password) => setForm({ ...form, password })}
            />
            <RoleSelect roles={roles?.roles ?? []} value={form.roleId} onChange={(roleId) => setForm({ ...form, roleId })} />
            <UserScopeFields
              hostIds={form.hostIds}
              guests={form.guests}
              onHostIds={(hostIds) => setForm({ ...form, hostIds })}
              onGuests={(guests) => setForm({ ...form, guests })}
            />
            <Button onClick={() => create.mutate()} disabled={create.isPending}>
              {t("users.add")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(editing)} onOpenChange={(next) => !next && setEditing(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? t("users.editTitle", { name: editing.username }) : ""}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <RoleSelect roles={roles?.roles ?? []} value={editForm.roleId} onChange={(roleId) => setEditForm({ ...editForm, roleId })} />
            <label className="text-sm">
              {t("table.status")}
              <select
                className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2"
                value={editForm.status}
                onChange={(e) => setEditForm({ ...editForm, status: e.target.value })}
              >
                <option value="ACTIVE">ACTIVE</option>
                <option value="DISABLED">DISABLED</option>
              </select>
            </label>
            <UserScopeFields
              hostIds={editForm.hostIds}
              guests={editForm.guests}
              onHostIds={(hostIds) => setEditForm({ ...editForm, hostIds })}
              onGuests={(guests) => setEditForm({ ...editForm, guests })}
            />
            <Button onClick={() => save.mutate()} disabled={save.isPending}>
              {t("common.save")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function RoleSelect({
  roles,
  value,
  onChange,
}: {
  roles: RoleRow[];
  value: string;
  onChange: (v: string) => void;
}) {
  const { t } = useI18n();
  return (
    <label className="text-sm">
      {t("users.role")}
      <select
        className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">{t("users.chooseRole")}</option>
        {roles.map((r) => (
          <option key={r.id} value={r.id}>
            {r.name}
          </option>
        ))}
      </select>
    </label>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
}) {
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      <Input type={type} value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}
