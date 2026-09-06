import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/env";

const PUBLIC = ["/login", "/api/auth/login", "/api/health"];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (
    PUBLIC.some((p) => pathname === p || pathname.startsWith(`${p}/`)) ||
    pathname.startsWith("/_next") ||
    pathname === "/favicon.ico"
  ) {
    return NextResponse.next();
  }

  const session = request.cookies.get(SESSION_COOKIE)?.value;
  if (!session && !pathname.startsWith("/api/")) {
    const login = new URL("/login", request.url);
    login.searchParams.set("next", pathname);
    return NextResponse.redirect(login);
  }

  const response = NextResponse.next();
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  return response;
}

export const config = {
  // Stream routes must skip proxy: Next clones PUT/POST bodies and caps them (~10 MB), which throttles ISO uploads to ~2 MB/s.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|api/federation/guest-files/(?:upload|download)|api/hosts/.+/files/(?:upload|download)|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
