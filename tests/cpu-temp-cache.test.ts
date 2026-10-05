import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProxmoxClient } from "@/server/proxmox/client";
import { mergeCpuTemp, peekNodeCpuTemp, peekNodeCpuTempOutcome, readNodeCpuTemp, retainCpuTemp } from "@/server/services/cpu-temp";

function client(baseUrl: string, read: () => Promise<unknown>): ProxmoxClient {
  return {
    http: { baseUrl },
    nodes: {
      cpuTemperature: () => read(),
      status: async () => ({}),
    },
  } as unknown as ProxmoxClient;
}

describe("cpu temperature cache", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps the last reading when a later refresh fails", () => {
    expect(retainCpuTemp({ celsius: 42, label: "Package id 0" }, null)).toEqual({
      celsius: 42,
      label: "Package id 0",
    });
    expect(retainCpuTemp({ celsius: 42, label: "Package id 0" }, { celsius: 51, label: "Package id 0" })).toEqual({
      celsius: 51,
      label: "Package id 0",
    });
  });

  it("serves a stale reading instead of going blank", async () => {
    let current = 42;
    const api = client("https://cache-stale.example", async () => [{ sensor: "Package id 0", temperature: current }]);
    vi.spyOn(Date, "now").mockReturnValue(1_000);
    await expect(readNodeCpuTemp(api, "pve")).resolves.toEqual({ celsius: 42, label: "Package id 0" });

    vi.spyOn(Date, "now").mockReturnValue(1_000 + 61_000);
    expect(peekNodeCpuTemp(api, "pve")).toEqual({ celsius: 42, label: "Package id 0" });

    current = 51;
    await expect(readNodeCpuTemp(api, "pve")).resolves.toEqual({ celsius: 51, label: "Package id 0" });
    expect(peekNodeCpuTemp(api, "pve")).toEqual({ celsius: 51, label: "Package id 0" });
  });

  it("keeps a thrown read as a failure, not as no sensors", async () => {
    const api = client("https://cache-empty.example", async () => {
      throw new Error("no sensors");
    });
    vi.spyOn(Date, "now").mockReturnValue(9_000);
    await expect(readNodeCpuTemp(api, "pve")).resolves.toBeNull();
    vi.spyOn(Date, "now").mockReturnValue(9_000 + 61_000);
    expect(peekNodeCpuTemp(api, "pve")).toBeNull();
    expect(peekNodeCpuTempOutcome(api, "pve")).toBe("failed");
  });

  it("does not turn a finished empty read into a later failure", () => {
    const none = mergeCpuTemp(undefined, { reading: null, outcome: "none" });
    expect(mergeCpuTemp(none, { reading: null, outcome: "failed" })).toEqual({ value: null, outcome: "none" });
    expect(mergeCpuTemp({ value: null, outcome: "failed" }, { reading: null, outcome: "none" })).toEqual({
      value: null,
      outcome: "none",
    });
  });

  it("does not replace a reading when the sensor read throws", async () => {
    let fail = false;
    const api = client("https://cache-fail.example", async () => {
      if (fail) throw new Error("shell closed");
      return [{ sensor: "Package id 0", temperature: 47 }];
    });
    vi.spyOn(Date, "now").mockReturnValue(5_000);
    await readNodeCpuTemp(api, "pve");
    fail = true;
    vi.spyOn(Date, "now").mockReturnValue(5_000 + 61_000);
    await expect(readNodeCpuTemp(api, "pve")).resolves.toEqual({ celsius: 47, label: "Package id 0" });
    expect(peekNodeCpuTemp(api, "pve")).toEqual({ celsius: 47, label: "Package id 0" });
  });
});
