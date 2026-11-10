/** Relative in-app path only. Blocks protocol-relative and open redirects. */
export function safeNextPath(value: string | null | undefined, fallback = "/dashboard"): string {
  if (!value) return fallback;
  const trimmed = value.trim();
  if (!trimmed.startsWith("/")) return fallback;
  // Browsers strip tab/CR/LF in URLs, so "/\t/evil.com" would become "//evil.com".
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) return fallback;
  if (trimmed.startsWith("//") || trimmed.startsWith("/\\")) return fallback;
  if (trimmed.includes("://") || trimmed.includes("\\")) return fallback;
  return trimmed;
}
