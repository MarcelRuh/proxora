/**
 * Windows UEFI ISOs sit on "Press any key to boot from CD or DVD...".
 * Keys must land after OVMF draws that prompt (~5–15s after QEMU is up), not in a burst.
 */
export function cdBootNudgePlan(
  rounds = 18,
  firstDelayMs = 6_000,
  roundDelayMs = 2_000,
): Array<{ key: string; delayMs: number }> {
  const steps: Array<{ key: string; delayMs: number }> = [];
  for (let round = 0; round < rounds; round++) {
    steps.push({
      key: "spc",
      delayMs: round === 0 ? firstDelayMs : roundDelayMs,
    });
  }
  return steps;
}
