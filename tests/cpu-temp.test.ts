import { describe, expect, it } from "vitest";
import {
  applyCpuTempWatchState,
  cpuTempFromNodeStatus,
  cpuTempFromSensorRows,
  cpuTempFromSensorsJson,
  parseCpuTempSettings,
} from "@/lib/cpu-temp";

describe("cpu temperature", () => {
  it("picks the package sensor over a hotter core", () => {
    const reading = cpuTempFromSensorRows([
      { sensor: "Core 0", temperature: 92 },
      { sensor: "Package id 0", temperature: 78 },
    ]);
    expect(reading).toEqual({ celsius: 78, label: "Package id 0" });
  });

  it("reads sensors -j and thermalstate", () => {
    const json = cpuTempFromSensorsJson({
      "k10temp-pci-00c3": {
        Tctl: { temp1_input: 61.25 },
        Tdie: { temp2_input: 61.25 },
      },
    });
    expect(json?.celsius).toBe(61.3);
    expect(json?.label).toBe("Tctl");

    const status = cpuTempFromNodeStatus({
      cpu: 0.2,
      thermalstate: JSON.stringify({
        "coretemp-isa-0000": { "Package id 0": { temp1_input: 54 } },
      }),
    });
    expect(status).toEqual({ celsius: 54, label: "Package id 0" });
  });

  it("ignores missing sensors", () => {
    expect(cpuTempFromSensorRows([])).toBeNull();
    expect(cpuTempFromNodeStatus({ cpu: 0.1 })).toBeNull();
    expect(cpuTempFromSensorsJson({ adapter: { "Adapter:": "PCI adapter" } })).toBeNull();
  });

  it("alerts once and clears below the hysteresis", () => {
    const hot = applyCpuTempWatchState(false, 86, 85, 75);
    expect(hot).toEqual({ notify: true, notified: true });
    expect(applyCpuTempWatchState(true, 80, 85, 75)).toEqual({ notify: false, notified: true });
    expect(applyCpuTempWatchState(true, 70, 85, 75)).toEqual({ notify: false, notified: false });
  });

  it("keeps clear below alert", () => {
    expect(parseCpuTempSettings({ alertCelsius: 80, clearCelsius: 90 })).toEqual({
      alertCelsius: 80,
      clearCelsius: 75,
    });
  });
});
