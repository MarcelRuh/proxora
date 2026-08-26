import { redirect } from "next/navigation";
import { getSession } from "@/server/auth/session";
import { AppShell } from "@/components/layout/app-shell";

export const dynamic = "force-dynamic";

export default async function AppGroupLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login");
  return <AppShell user={session.user}>{children}</AppShell>;
}
