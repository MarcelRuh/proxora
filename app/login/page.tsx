import { redirect } from "next/navigation";
import { getSession } from "@/server/auth/session";
import { LoginForm } from "@/components/auth/login-form";
import { safeNextPath } from "@/lib/safe-next";
import { resolvePostLoginPath } from "@/lib/home-path";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const params = await searchParams;
  const next = safeNextPath(params.next);
  const session = await getSession();
  if (session) redirect(resolvePostLoginPath(session.user, next));
  return <LoginForm next={next} />;
}
