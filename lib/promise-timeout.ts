export async function withTimeoutFallback<T>(promise: Promise<T>, ms: number, fallback: () => T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const guarded = promise.then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => ({ ok: false as const, error }),
  );
  const timeout = new Promise<{ ok: "timeout" }>((resolve) => {
    timer = setTimeout(() => resolve({ ok: "timeout" }), ms);
  });
  try {
    const result = await Promise.race([guarded, timeout]);
    if (result.ok === true) return result.value;
    if (result.ok === false) {
      throw result.error;
    }
    return fallback();
  } finally {
    if (timer) clearTimeout(timer);
  }
}
