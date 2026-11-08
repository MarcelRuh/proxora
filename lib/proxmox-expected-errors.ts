/**
 * Proxmox endpoints that commonly return errors on healthy hosts/VMs.
 * Log these at debug — they are not actionable outages.
 */

const SENSOR_PATH =
  /\/nodes\/[^/]+\/hardware\/sensors(?:\/|$)/i;
const AGENT_PATH =
  /\/nodes\/[^/]+\/qemu\/\d+\/agent(?:\/|$)/i;

function agentNotRunning(message: string | null | undefined): boolean {
  const lower = String(message ?? "").toLowerCase();
  return (
    lower.includes("guest agent") ||
    lower.includes("qemu-guest-agent") ||
    lower.includes("not running") ||
    lower.includes("no qga") ||
    lower.includes("agent is not")
  );
}

/** CPU / thermal sensor API missing or unimplemented on the node. */
export function isExpectedSensorMiss(
  path: string,
  status: number,
  _message?: string | null,
): boolean {
  if (!SENSOR_PATH.test(path)) return false;
  return status === 400 || status === 404 || status === 500 || status === 501;
}

/** QEMU guest agent not installed / not running in the guest. */
export function isExpectedGuestAgentMiss(
  path: string,
  status: number,
  message?: string | null,
): boolean {
  if (!AGENT_PATH.test(path)) return false;
  if (status === 500 || status === 501 || status === 404 || status === 400) {
    return agentNotRunning(message) || status === 501 || status === 404;
  }
  return false;
}

export function isExpectedProxmoxApiNoise(
  path: string,
  status: number,
  message?: string | null,
): boolean {
  return isExpectedSensorMiss(path, status, message) || isExpectedGuestAgentMiss(path, status, message);
}
