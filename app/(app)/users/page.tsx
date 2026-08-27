"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input, Label } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/layout/page-header";

type UserRow = {
  id: string;
  username: string;
  email: string;
  status: string;
  lastLoginAt: string | null;
  createdAt: string;
  totpEnabled: boolean;
  role: { name: string; id: string };
};

type RoleRow = { id: string; name: string; slug: string };

export default function UsersPage() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["users"], queryFn: () => api<{ users: UserRow[] }>("/api/users") });
  const { data: roles } = useQuery({ queryKey: ["roles"], queryFn: () => api<{ roles: RoleRow[] }>("/api/roles") });
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ username: "", email: "", password: "", roleId: "" });
  const create = useMutation({
    mutationFn: () => api("/api/users", { method: "POST", body: JSON.stringify(form) }),
    onSuccess: () => {
      toast.success("User created");
      setOpen(false);
      void qc.invalidateQueries({ queryKey: ["users"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-4">
      <PageHeader
        kicker="Zugriff"
        title="Benutzer"
        actions={<Button onClick={() => setOpen(true)}>Benutzer hinzufügen</Button>}
      />
      <Card>
        <CardHeader>
          <CardTitle>Manager accounts</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="py-2">Username</th>
                <th>Email</th>
                <th>Role</th>
                <th>Status</th>
                <th>2FA</th>
                <th>Last login</th>
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
                  <td>{u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create user</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <Field label="Username" value={form.username} onChange={(username) => setForm({ ...form, username })} />
            <Field label="Email" value={form.email} onChange={(email) => setForm({ ...form, email })} />
            <Field label="Password" type="password" value={form.password} onChange={(password) => setForm({ ...form, password })} />
            <label className="text-sm">
              Role
              <select
                className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2"
                value={form.roleId}
                onChange={(e) => setForm({ ...form, roleId: e.target.value })}
              >
                <option value="">Select role</option>
                {(roles?.roles ?? []).map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </label>
            <Button onClick={() => create.mutate()}>Create</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Field({ label, value, onChange, type = "text" }: { label: string; value: string; onChange: (v: string) => void; type?: string }) {
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      <Input type={type} value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}
