import { describe, expect, it } from "vitest";
import {
  HOST_HEALTHCHECK_MS,
  HOST_RECONNECT_MS,
  nextHostProbeDelayMs,
} from "@/lib/host-probe";

describe("host reconnect cadence", () => {
  it("retries quickly while any host is down after a drop or restart", () => {
    expect(nextHostProbeDelayMs(["ONLINE", "ERROR"])).toBe(HOST_RECONNECT_MS);
    expect(nextHostProbeDelayMs(["CONNECTING"])).toBe(HOST_RECONNECT_MS);
    expect(nextHostProbeDelayMs(["OFFLINE", "ONLINE"])).toBe(HOST_RECONNECT_MS);
  });

  it("slows to a health check when every host is online", () => {
    expect(nextHostProbeDelayMs(["ONLINE", "ONLINE"])).toBe(HOST_HEALTHCHECK_MS);
    expect(nextHostProbeDelayMs(["ONLINE", "MAINTENANCE"])).toBe(HOST_HEALTHCHECK_MS);
    expect(nextHostProbeDelayMs([])).toBe(HOST_HEALTHCHECK_MS);
  });
});
