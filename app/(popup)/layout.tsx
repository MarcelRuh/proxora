import { getSession } from "@/server/auth/session";
import { redirect } from "next/navigation";
import { SessionUserProvider } from "@/components/auth/session-user";

export const dynamic = "force-dynamic";

export default async function PopupLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login");
  return (
    <SessionUserProvider user={session.user}>
      <div className="flex h-dvh flex-col overflow-hidden bg-background">{children}</div>
    </SessionUserProvider>
  );
}
