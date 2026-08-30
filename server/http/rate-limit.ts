const buckets = new Map<string, { count: number; resetAt: number }>();

function prune(now: number) {
  if (buckets.size < 256) return;
  for (const [key, entry] of buckets) {
    if (entry.resetAt < now) buckets.delete(key);
  }
}

export function rateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  prune(now);
  const current = buckets.get(key);
  if (!current || current.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (current.count >= limit) {
    return false;
  }
  current.count += 1;
  return true;
}

export function rateLimitOrThrow(key: string, limit: number, windowMs: number) {
  if (!rateLimit(key, limit, windowMs)) {
    const error = new Error("Too many requests");
    (error as Error & { status: number; code: string }).status = 429;
    (error as Error & { status: number; code: string }).code = "RATE_LIMITED";
    throw error;
  }
}
