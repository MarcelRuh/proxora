export const MEMORY_PRESETS_MIB = [128, 256, 512, 1024, 2048, 4096, 8192, 16384, 32768, 65536] as const;

export function formatMemoryMib(mib: number): string {
  if (mib >= 1024 && mib % 1024 === 0) return `${mib / 1024} GiB`;
  return `${mib} MiB`;
}

export function isMemoryPreset(mib: number): boolean {
  return (MEMORY_PRESETS_MIB as readonly number[]).includes(mib);
}
