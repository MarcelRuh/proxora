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
        error: "Validation failed",
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

export function assertSameOrigin(request: Request) {
  if (request.method === "GET" || request.method === "HEAD" || request.method === "OPTIONS") {
    return;
  }
  const origin = request.headers.get("origin");
  if (!origin) return;
  const expected = process.env.APP_URL;
  if (expected) {
    try {
      if (new URL(origin).origin !== new URL(expected).origin) {
        throw new AppError(403, "Invalid origin", "CSRF");
      }
    } catch (error) {
      if (error instanceof AppError) throw error;
    }
    return;
  }
  const host = request.headers.get("host");
  if (host && new URL(origin).host !== host) {
    throw new AppError(403, "Invalid origin", "CSRF");
  }
}
