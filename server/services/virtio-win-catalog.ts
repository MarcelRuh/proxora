import {
  parseVirtioArchiveHtml,
  pickRecommendedVirtioRelease,
  virtioCatalogItemFromRelease,
  VIRTIO_ARCHIVE_BASE,
  VIRTIO_WIN_CATALOG_ITEM,
  type IsoCatalogItem,
} from "@/lib/iso-images";
import { logger } from "@/lib/logger";

const CACHE_TTL_MS = 6 * 60 * 60_000;
const FETCH_TIMEOUT_MS = 12_000;

let cache: { at: number; item: IsoCatalogItem } | null = null;

export function clearVirtioCatalogCache() {
  cache = null;
}

async function fetchArchiveHtml(): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${VIRTIO_ARCHIVE_BASE}/?C=M&O=D`, {
      headers: { "User-Agent": "proxora-virtio-catalog", Accept: "text/html" },
      signal: controller.signal,
      redirect: "follow",
    });
    if (!res.ok) throw new Error(`VirtIO archive HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

/** Live Fedora VirtIO recommendation (cached); falls back to the pinned catalog item. */
export async function resolveVirtioCatalogItem(): Promise<IsoCatalogItem> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.item;
  try {
    const html = await fetchArchiveHtml();
    const releases = parseVirtioArchiveHtml(html);
    const picked = pickRecommendedVirtioRelease(releases);
    const item = virtioCatalogItemFromRelease(picked);
    cache = { at: Date.now(), item };
    return item;
  } catch (error) {
    logger.warn(
      { err: error instanceof Error ? error.message : String(error) },
      "VirtIO catalog fetch failed",
    );
    if (cache) return cache.item;
    return VIRTIO_WIN_CATALOG_ITEM;
  }
}
