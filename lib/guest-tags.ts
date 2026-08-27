export function parseGuestTags(tags: string | undefined | null): string[] {
  if (!tags) return [];
  return [...new Set(tags.split(/[;,]+/).map((tag) => tag.trim()).filter(Boolean))];
}

export function guestHasTag(tags: string | undefined | null, tag: string): boolean {
  if (!tag) return true;
  const needle = tag.trim().toLowerCase();
  return parseGuestTags(tags).some((item) => item.toLowerCase() === needle);
}

export function uniqueGuestTags(items: Array<{ tags?: string | null }>): string[] {
  const tags = new Set<string>();
  for (const item of items) {
    for (const tag of parseGuestTags(item.tags)) tags.add(tag);
  }
  return [...tags].sort((a, b) => a.localeCompare(b, "de"));
}
