import { describe, expect, it } from "vitest";
import {
  isExpectedGuestAgentMiss,
  isExpectedProxmoxApiNoise,
  isExpectedSensorMiss,
} from "@/lib/proxmox-expected-errors";

describe("proxmox expected API noise", () => {
  it("treats unimplemented CPU sensor API as expected", () => {
    const path = "/nodes/pve-power/hardware/sensors/temperature/cpu";
    expect(isExpectedSensorMiss(path, 501, "Method not implemented")).toBe(true);
    expect(isExpectedProxmoxApiNoise(path, 501, "Method not implemented")).toBe(true);
    expect(isExpectedProxmoxApiNoise(path, 200, "ok")).toBe(false);
  });

  it("treats guest agent not running as expected", () => {
    const path = "/nodes/pve-power/qemu/248/agent/get-fsinfo";
    expect(isExpectedGuestAgentMiss(path, 500, "QEMU guest agent is not running")).toBe(true);
    expect(isExpectedProxmoxApiNoise(path, 500, "QEMU guest agent is not running")).toBe(true);
    expect(isExpectedProxmoxApiNoise(path, 500, "permission denied")).toBe(false);
  });

  it("does not silence unrelated failures", () => {
    expect(isExpectedProxmoxApiNoise("/nodes/pve/qemu/1/status/current", 500, "boom")).toBe(false);
    expect(isExpectedProxmoxApiNoise("/nodes/pve/version", 401, "auth")).toBe(false);
  });
});
