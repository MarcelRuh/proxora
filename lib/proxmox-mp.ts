export function parseMpSpec(value: string): { volume: string; path: string; options: string[] } {
  const parts = value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  const volume = parts[0] ?? "";
  let path = "";
  const options: string[] = [];
  for (const part of parts.slice(1)) {
    if (part.startsWith("mp=")) path = part.slice(3);
    else options.push(part);
  }
  return { volume, path, options };
}

export function buildMpSpec(volume: string, path: string, options: string[] = []): string {
  const guestPath = path.startsWith("/") ? path : `/${path}`;
  return [volume.trim(), `mp=${guestPath}`, ...options.filter(Boolean)].join(",");
}

export function isBindVolume(volume: string): boolean {
  return volume.startsWith("/");
}

export function nextIndexedKey(prefix: string, keys: Iterable<string>, max = 256): string {
  const set = new Set(keys);
  for (let i = 0; i < max; i++) {
    if (!set.has(`${prefix}${i}`)) return `${prefix}${i}`;
  }
  return `${prefix}0`;
}
