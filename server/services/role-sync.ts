import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { ROLE_PRESETS } from "@/lib/permissions";

let started: Promise<void> | null = null;

export function ensureSystemRoles() {
  if (!started) started = syncSystemRoles();
  return started;
}

async function syncSystemRoles() {
  try {
    for (const [slug, preset] of Object.entries(ROLE_PRESETS)) {
      await prisma.role.updateMany({
        where: { slug, isSystem: true },
        data: {
          name: preset.name,
          description: preset.description,
          permissions: [...preset.permissions],
        },
      });
    }
  } catch (error) {
    logger.warn({ err: error }, "System role sync skipped");
  }
}
