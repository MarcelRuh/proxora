import { ValidationError } from "@/lib/errors";

export const SUITE_EMBEDS_KEY = "suite.embeds";
const MAX_APPS = 24;
const ID_RE = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;

export type SuiteApp = {
  id: string;
  name: string;
  url: string;
};

export type SuiteEmbeds = {
  apps: SuiteApp[];
};

export function emptySuiteEmbeds(): SuiteEmbeds {
  return { apps: [] };
}

function safeUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.username || url.password) return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function legacyApp(id: string, name: string, url: unknown): SuiteApp | null {
  const safe = safeUrl(url);
  return safe ? { id, name, url: safe } : null;
}

function storedApp(value: unknown): SuiteApp | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as { id?: unknown; name?: unknown; url?: unknown };
  const url = safeUrl(raw.url);
  if (typeof raw.id !== "string" || !ID_RE.test(raw.id)) return null;
  if (typeof raw.name !== "string" || !raw.name.trim() || !url) return null;
  return { id: raw.id, name: raw.name.trim(), url };
}

export function readSuiteEmbeds(value: unknown): SuiteEmbeds {
  if (!value || typeof value !== "object") return emptySuiteEmbeds();
  const raw = value as { apps?: unknown; dockora?: unknown; sambora?: unknown };
  if (Array.isArray(raw.apps)) {
    const seen = new Set<string>();
    const apps: SuiteApp[] = [];
    for (const item of raw.apps) {
      const app = storedApp(item);
      if (!app || seen.has(app.id)) continue;
      seen.add(app.id);
      apps.push(app);
    }
    return { apps };
  }
  return {
    apps: [
      legacyApp("dockora", "Dockora", raw.dockora),
      legacyApp("sambora", "Sambora", raw.sambora),
    ].filter((app): app is SuiteApp => app !== null),
  };
}

export function suiteAppId(name: string, taken: Set<string>): string {
  const base = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  const root = base || "app";
  let id = root;
  let n = 2;
  while (taken.has(id) || !ID_RE.test(id)) {
    const suffix = `-${n}`;
    id = `${root.slice(0, 40 - suffix.length)}${suffix}`;
    n += 1;
  }
  taken.add(id);
  return id;
}

export function parseEmbedUrl(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value !== "string") throw new ValidationError("Address must be a URL");
  const trimmed = value.trim();
  if (!trimmed) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new ValidationError("Address must be an http or https URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ValidationError("Address must be an http or https URL");
  }
  if (url.username || url.password) throw new ValidationError("Address must not contain a password");
  url.hash = "";
  return url.toString();
}

export function parseSuiteApps(value: unknown): SuiteApp[] {
  if (!Array.isArray(value)) throw new ValidationError("Apps must be a list");
  if (value.length > MAX_APPS) throw new ValidationError("Too many apps");
  const apps: SuiteApp[] = [];
  const taken = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== "object") throw new ValidationError("Each app needs a name and an address");
    const raw = item as { id?: unknown; name?: unknown; url?: unknown };
    const name = typeof raw.name === "string" ? raw.name.trim() : "";
    const urlText = typeof raw.url === "string" ? raw.url.trim() : "";
    if (!name && !urlText) continue;
    if (!name || name.length > 48) throw new ValidationError("Each app needs a name");
    const url = parseEmbedUrl(urlText);
    if (!url) throw new ValidationError("Each app needs an address");
    const given = typeof raw.id === "string" ? raw.id.trim().toLowerCase() : "";
    if (given && (!ID_RE.test(given) || taken.has(given))) throw new ValidationError("Each app needs its own name");
    const id = given || suiteAppId(name, taken);
    if (given) taken.add(id);
    apps.push({ id, name, url });
  }
  return apps;
}
