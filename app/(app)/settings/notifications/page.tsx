import { redirect } from "next/navigation";

export default function NotificationsRedirectPage() {
  redirect("/settings#meldungen");
}
