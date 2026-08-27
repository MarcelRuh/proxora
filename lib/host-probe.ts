/** Retry failed host connections until they come back. */
export const HOST_RECONNECT_MS = 15_000;
/** Health-check interval while every host is online. */
export const HOST_HEALTHCHECK_MS = 60_000;
/** Extra probe shortly after a live request marks a host ERROR. */
export const HOST_RECONNECT_KICK_MS = 3_000;

export function nextHostProbeDelayMs(states: readonly string[]): number {
  const needsReconnect = states.some(
    (state) => state !== "ONLINE" && state !== "MAINTENANCE",
  );
  return needsReconnect ? HOST_RECONNECT_MS : HOST_HEALTHCHECK_MS;
}
