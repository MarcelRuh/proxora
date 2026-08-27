import { redirect } from "next/navigation";
import { getSession } from "@/server/auth/session";
import { AppShell } from "@/components/layout/app-shell";
import { SessionUserProvider } from "@/components/auth/session-user";

export const dynamic = "force-dynamic";

export default async function AppGroupLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login");
  return (
    <SessionUserProvider user={session.user}>
      <AppShell user={session.user}>{children}</AppShell>
    </SessionUserProvider>
  );
}
