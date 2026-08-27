"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ConfirmAction } from "@/components/confirm-action";
import { RolePermissionPicker } from "@/components/access/role-permission-picker";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/layout/page-header";
import { useI18n } from "@/components/i18n/locale-provider";
import { useCan } from "@/components/auth/session-user";
import { sanitizePermissions } from "@/lib/permissions";

type Role = {
  id: string;
  name: string;
  slug: string;
  description: string;
  isSystem: boolean;
  permissions: string[];
  _count: { users: number };
};

function slugFromName(name: string) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

export default function RolesPage() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const canCreate = useCan("roles.create");
  const canUpdate = useCan("roles.update");
  const canDelete = useCan("roles.delete");
  const { data } = useQuery({ queryKey: ["roles"], queryFn: () => api<{ roles: Role[] }>("/api/roles") });
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  const [perms, setPerms] = useState<string[]>([]);
  const [editing, setEditing] = useState<Role | null>(null);

  const create = useMutation({
    mutationFn: () =>
      api("/api/roles", {
        method: "POST",
        body: JSON.stringify({ name, slug: slug || slugFromName(name), description, permissions: perms }),
      }),
    onSuccess: () => {
      toast.success(t("roles.created"));
      setName("");
      setSlug("");
      setDescription("");
      setPerms([]);
      void qc.invalidateQueries({ queryKey: ["roles"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const save = useMutation({
    mutationFn: () =>
      api(`/api/roles/${editing!.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: editing!.name,
          description: editing!.description,
          permissions: editing!.permissions,
        }),
      }),
    onSuccess: () => {
      toast.success(t("roles.updated"));
      setEditing(null);
      void qc.invalidateQueries({ queryKey: ["roles"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-4">
      <PageHeader kicker={t("page.access")} title={t("roles.title")} description={t("roles.description")} />
      <div className="grid gap-4 lg:grid-cols-2">
        {(data?.roles ?? []).map((role) => (
          <Card key={role.id}>
            <CardHeader className="flex flex-row items-center justify-between gap-2">
              <CardTitle>{role.name}</CardTitle>
              {role.isSystem ? <Badge>{t("roles.system")}</Badge> : null}
            </CardHeader>
            <CardContent className="space-y-2">
              <p className="text-sm text-muted-foreground">{role.description}</p>
              <p className="text-xs text-muted-foreground">
                {t("roles.meta", { users: role._count.users, n: sanitizePermissions(role.permissions).length })}
              </p>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    setEditing({
                      ...role,
                      permissions: sanitizePermissions(role.permissions),
                    })
                  }
                >
                  {t("roles.edit")}
                </Button>
                {!role.isSystem && canDelete ? (
                  <ConfirmAction
                    title={t("roles.deleteTitle", { name: role.name })}
                    description={t("roles.deleteBody")}
                    actionLabel={t("roles.delete")}
                    destructive
                    onConfirm={async () => {
                      await api(`/api/roles/${role.id}`, { method: "DELETE" });
                      toast.success(t("roles.deleted"));
                      void qc.invalidateQueries({ queryKey: ["roles"] });
                    }}
                  >
                    <Button size="sm" variant="destructive">
                      {t("roles.delete")}
                    </Button>
                  </ConfirmAction>
                ) : null}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {editing ? (
        <Card>
          <CardHeader>
            <CardTitle>
              {editing.isSystem ? editing.name : t("roles.editTitle", { name: editing.name })}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {!editing.isSystem ? (
              <>
                <Input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} disabled={!canUpdate} />
                <Input
                  value={editing.description}
                  onChange={(e) => setEditing({ ...editing, description: e.target.value })}
                  disabled={!canUpdate}
                />
              </>
            ) : (
              <p className="text-sm text-muted-foreground">{t("roles.systemLocked")}</p>
            )}
            <RolePermissionPicker
              value={editing.permissions}
              onChange={(permissions) => setEditing({ ...editing, permissions })}
              disabled={editing.isSystem || !canUpdate}
            />
            <div className="flex gap-2">
              {!editing.isSystem && canUpdate ? (
                <Button onClick={() => save.mutate()} disabled={save.isPending}>
                  {t("common.save")}
                </Button>
              ) : null}
              <Button variant="outline" onClick={() => setEditing(null)}>
                {t("common.cancel")}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {canCreate ? (
        <Card>
          <CardHeader>
            <CardTitle>{t("roles.create")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Input placeholder={t("create.name")} value={name} onChange={(e) => setName(e.target.value)} />
            <Input
              placeholder={t("roles.slug")}
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
            />
            <Input placeholder={t("roles.descriptionField")} value={description} onChange={(e) => setDescription(e.target.value)} />
            <RolePermissionPicker value={perms} onChange={setPerms} />
            <Button onClick={() => create.mutate()} disabled={create.isPending || name.trim().length < 2 || perms.length === 0}>
              {t("roles.create")}
            </Button>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
