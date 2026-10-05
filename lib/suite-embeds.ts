import { ValidationError } from "@/lib/errors";

export const SUITE_EMBEDS_KEY = "suite.embeds";

export type SuiteEmbeds = {
  dockora: string | null;
  sambora: string | null;
};

export function emptySuiteEmbeds(): SuiteEmbeds {
  return { dockora: null, sambora: null };
}

export function readSuiteEmbeds(value: unknown): SuiteEmbeds {
  if (!value || typeof value !== "object") return emptySuiteEmbeds();
  const raw = value as { dockora?: unknown; sambora?: unknown };
  return {
    dockora: typeof raw.dockora === "string" ? raw.dockora : null,
    sambora: typeof raw.sambora === "string" ? raw.sambora : null,
  };
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
