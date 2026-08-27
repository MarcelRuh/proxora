"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ALL_PERMISSIONS } from "@/lib/permissions";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/layout/page-header";

type Role = {
  id: string;
  name: string;
  slug: string;
  description: string;
  isSystem: boolean;
  permissions: string[];
  _count: { users: number };
};

export default function RolesPage() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["roles"], queryFn: () => api<{ roles: Role[] }>("/api/roles") });
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [perms, setPerms] = useState<string[]>([]);
  const create = useMutation({
    mutationFn: () => api("/api/roles", { method: "POST", body: JSON.stringify({ name, slug, permissions: perms }) }),
    onSuccess: () => {
      toast.success("Role created");
      void qc.invalidateQueries({ queryKey: ["roles"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-4">
      <PageHeader kicker="Zugriff" title="Rollen" />
      <div className="grid gap-4 lg:grid-cols-2">
        {(data?.roles ?? []).map((role) => (
          <Card key={role.id}>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>{role.name}</CardTitle>
              {role.isSystem ? <Badge>system</Badge> : null}
            </CardHeader>
            <CardContent>
              <p className="mb-2 text-sm text-muted-foreground">{role.description}</p>
              <p className="text-xs text-muted-foreground">{role._count.users} users · {role.permissions.length} permissions</p>
            </CardContent>
          </Card>
        ))}
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Custom role</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
          <Input placeholder="slug" value={slug} onChange={(e) => setSlug(e.target.value)} />
          <div className="grid max-h-64 grid-cols-2 gap-2 overflow-auto text-sm">
            {ALL_PERMISSIONS.map((p) => (
              <label key={p} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={perms.includes(p)}
                  onChange={(e) =>
                    setPerms(e.target.checked ? [...perms, p] : perms.filter((x) => x !== p))
                  }
                />
                {p}
              </label>
            ))}
          </div>
          <Button onClick={() => create.mutate()}>Create role</Button>
        </CardContent>
      </Card>
    </div>
  );
}
