import { prisma } from "@/lib/db";
import { json } from "@/server/http/respond";
import { APP_NAME, APP_VERSION } from "@/lib/version";

export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    return json({ status: "error", service: "proxora", name: APP_NAME, version: APP_VERSION }, 503);
  }
  return json({ status: "ok", service: "proxora", name: APP_NAME, version: APP_VERSION });
}
