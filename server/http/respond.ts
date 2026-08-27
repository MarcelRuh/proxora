import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";

export function json<T>(data: T, status = 200, headers?: HeadersInit) {
  return NextResponse.json(data, { status, headers });
}

export function handleRouteError(error: unknown) {
  if (error instanceof ZodError) {
    return json(
      {
        error: error.issues.map((issue) => issue.message).join(" · ") || "Validation failed",
        code: "VALIDATION_ERROR",
        details: error.flatten(),
      },
      400,
    );
  }
  if (error instanceof AppError) {
    return json(
      {
        error: error.message,
        code: error.code,
        details: error.details,
      },
      error.status,
    );
  }
  const maybe = error as { status?: number; code?: string; message?: string };
  if (maybe.status === 429) {
    return json({ error: "Too many requests", code: "RATE_LIMITED" }, 429);
  }
  logger.error({ err: error }, "Unhandled API error");
  return json({ error: "Internal server error", code: "INTERNAL_ERROR" }, 500);
}

function headerHost(request: Request): string | null {
  const forwarded = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const host = forwarded || request.headers.get("host");
  return host ? host.toLowerCase() : null;
}

function originHost(origin: string): string | null {
  try {
    return new URL(origin).host.toLowerCase();
  } catch {
    return null;
  }
}

function originMatchesEntry(origin: string, entry: string): boolean {
  const trimmed = entry.trim();
  if (!trimmed) return false;
  try {
    const parsed = trimmed.includes("://") ? new URL(trimmed) : new URL(`http://${trimmed}`);
    return new URL(origin).origin === parsed.origin || new URL(origin).host === parsed.host;
  } catch {
    return false;
  }
}

/** Same-origin (Host / X-Forwarded-Host) plus APP_URL and APP_ALLOWED_ORIGINS. */
export function isAllowedOrigin(request: Request, origin: string): boolean {
  const requestHost = headerHost(request);
  const fromOrigin = originHost(origin);
  if (requestHost && fromOrigin && requestHost === fromOrigin) {
    return true;
  }
  const extras = [
    process.env.APP_URL ?? "",
    ...(process.env.APP_ALLOWED_ORIGINS ?? "").split(","),
  ];
  return extras.some((entry) => originMatchesEntry(origin, entry));
}

export function assertSameOrigin(request: Request) {
  if (request.method === "GET" || request.method === "HEAD" || request.method === "OPTIONS") {
    return;
  }
  const origin = request.headers.get("origin");
  if (!origin) return;
  if (!isAllowedOrigin(request, origin)) {
    throw new AppError(403, "Invalid origin", "CSRF");
  }
}
