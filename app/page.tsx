import { redirect } from "next/navigation";
import { getSession } from "@/server/auth/session";
import { homePathForUser } from "@/lib/home-path";

export default async function Home() {
  const session = await getSession();
  redirect(session ? homePathForUser(session.user) : "/login");
}
