import { GUEST_IP_SETTING_KEY } from "@/lib/create-ip";

export const PUBLIC_SETTING_KEYS = [GUEST_IP_SETTING_KEY] as const;

export type PublicSettingKey = (typeof PUBLIC_SETTING_KEYS)[number];

export function isPublicSettingKey(key: string): key is PublicSettingKey {
  return (PUBLIC_SETTING_KEYS as readonly string[]).includes(key);
}
