import { redirect } from "next/navigation";
import { getSession } from "@/server/auth/session";
import { userHasPermission } from "@/lib/permissions";
import { homePathForUser } from "@/lib/home-path";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!userHasPermission(session.user, "hosts.view")) redirect(homePathForUser(session.user));
  return children;
}
