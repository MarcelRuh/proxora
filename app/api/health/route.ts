import { json } from "@/server/http/respond";
import { APP_NAME, APP_VERSION } from "@/lib/version";

export async function GET() {
  return json({ status: "ok", service: "proxora", name: APP_NAME, version: APP_VERSION });
}
