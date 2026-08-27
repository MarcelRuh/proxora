import { prisma } from "@/lib/db";
import {
  GUEST_IP_SETTING_KEY,
  networksForHost,
  parseGuestIpSettings,
  type GuestIpNetwork,
  type GuestIpSettings,
} from "@/lib/create-ip";

export async function loadGuestIpSettings(): Promise<GuestIpSettings> {
  const row = await prisma.setting.findUnique({ where: { key: GUEST_IP_SETTING_KEY } });
  return parseGuestIpSettings(row?.value);
}

export async function networksForHostId(hostId: string): Promise<GuestIpNetwork[]> {
  return networksForHost(await loadGuestIpSettings(), hostId);
}
