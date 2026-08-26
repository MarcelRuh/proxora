"use client";

import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/api";

type Log = {
  id: string;
  action: string;
  target: string | null;
  ip: string | null;
  result: string;
  error: string | null;
  createdAt: string;
  user: { username: string } | null;
  host: { name: string } | null;
};

export default function AuditPage() {
  const { data } = useQuery({
    queryKey: ["audit"],
    queryFn: () => api<{ logs: Log[] }>("/api/audit"),
    refetchInterval: 15_000,
  });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Audit log</h1>
        <p className="text-sm text-muted-foreground">Immutable history of manager actions. Regular users cannot edit these records.</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Events</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="py-2">Time</th>
                <th>User</th>
                <th>Host</th>
                <th>Action</th>
                <th>Target</th>
                <th>Result</th>
                <th>IP</th>
              </tr>
            </thead>
            <tbody>
              {(data?.logs ?? []).map((l) => (
                <tr key={l.id} className="border-t border-border">
                  <td className="py-2">{new Date(l.createdAt).toLocaleString()}</td>
                  <td>{l.user?.username ?? "—"}</td>
                  <td>{l.host?.name ?? "—"}</td>
                  <td>{l.action}</td>
                  <td>{l.target}</td>
                  <td>
                    <Badge variant={l.result === "SUCCESS" ? "success" : "danger"}>{l.result}</Badge>
                  </td>
                  <td>{l.ip}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
