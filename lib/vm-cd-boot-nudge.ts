/** Keys QEMU accepts for "press any key to boot from CD". */
export const CD_BOOT_NUDGE_KEYS = ["spc", "ret", "spc"] as const;

export function cdBootNudgePlan(rounds = 4, roundDelayMs = 2_500, keyDelayMs = 350) {
  const steps: Array<{ key: string; delayMs: number }> = [];
  for (let round = 0; round < rounds; round++) {
    for (let i = 0; i < CD_BOOT_NUDGE_KEYS.length; i++) {
      const key = CD_BOOT_NUDGE_KEYS[i]!;
      steps.push({
        key,
        delayMs: round === 0 && i === 0 ? roundDelayMs : i === 0 ? roundDelayMs : keyDelayMs,
      });
    }
  }
  return steps;
}
