export function plainGuestNote(raw: unknown, max = 140): string | undefined {
  if (typeof raw !== "string") return undefined;
  const text = raw
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return undefined;
  return text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1))}…`;
}
