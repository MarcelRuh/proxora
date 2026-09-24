import { applyDiskWatchState } from "@/lib/disk-alerts";

export const CPU_TEMP_ALERT_CELSIUS = 85;
export const CPU_TEMP_CLEAR_CELSIUS = 75;
export const CPU_TEMP_SETTING_KEY = "cpu.temp.alerts";
export const CPU_TEMP_WATCH_STATE_KEY = "cpu.temp.watch.state";

export type CpuTempReading = { celsius: number; label: string };

export type CpuTempAlertSettings = {
  alertCelsius: number;
  clearCelsius: number;
};

export type CpuTempSample = {
  key: string;
  celsius: number;
  label: string;
  hostId: string;
  hostName: string;
  node: string;
};

export type CpuTempWatchState = {
  notified: Record<string, boolean>;
  samples: CpuTempSample[];
};

function clampCelsius(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(120, Math.max(40, Math.round(n)));
}

export function parseCpuTempSettings(value: unknown): CpuTempAlertSettings {
  const raw = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const alertCelsius = clampCelsius(raw.alertCelsius, CPU_TEMP_ALERT_CELSIUS);
  let clearCelsius = clampCelsius(raw.clearCelsius, CPU_TEMP_CLEAR_CELSIUS);
  if (clearCelsius >= alertCelsius) clearCelsius = Math.max(40, alertCelsius - 5);
  return { alertCelsius, clearCelsius };
}

export function parseCpuTempWatchState(value: unknown): CpuTempWatchState {
  const raw = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const notified: Record<string, boolean> = {};
  if (raw.notified && typeof raw.notified === "object") {
    for (const [key, flag] of Object.entries(raw.notified as Record<string, unknown>)) {
      if (typeof flag === "boolean") notified[key] = flag;
    }
  }
  const samples = Array.isArray(raw.samples)
    ? raw.samples.filter((item): item is CpuTempSample => {
        if (!item || typeof item !== "object") return false;
        const row = item as CpuTempSample;
        return typeof row.key === "string" && Number.isFinite(row.celsius);
      })
    : [];
  return { notified, samples };
}

/** Plausible package/core temperature in °C. Rejects 0 and sensor-missing sentinels. */
export function celsiusFromUnknown(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0 || n > 150) return null;
  return Math.round(n * 10) / 10;
}

function isPackageLabel(label: string): boolean {
  return /package|tctl|tdie|k10temp/i.test(label);
}

function preferReading(current: CpuTempReading | null, next: CpuTempReading): CpuTempReading {
  if (!current) return next;
  const nextPackage = isPackageLabel(next.label);
  const currentPackage = isPackageLabel(current.label);
  if (nextPackage && !currentPackage) return next;
  if (nextPackage === currentPackage && next.celsius > current.celsius) return next;
  return current;
}

export function cpuTempFromSensorRows(rows: unknown): CpuTempReading | null {
  if (!Array.isArray(rows)) return null;
  let best: CpuTempReading | null = null;
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const rec = row as Record<string, unknown>;
    const celsius = celsiusFromUnknown(rec.temperature ?? rec.temp ?? rec.value);
    if (celsius == null) continue;
    const label = String(rec.sensor ?? rec.name ?? rec.chip ?? "CPU");
    best = preferReading(best, { celsius, label });
  }
  return best;
}

/** `sensors -j` object, or a JSON string of that object. */
export function cpuTempFromSensorsJson(raw: unknown): CpuTempReading | null {
  let data = raw;
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    try {
      data = JSON.parse(trimmed) as unknown;
    } catch {
      return null;
    }
  }
  if (Array.isArray(data)) return cpuTempFromSensorRows(data);
  if (!data || typeof data !== "object") return null;
  let best: CpuTempReading | null = null;
  for (const block of Object.values(data as Record<string, unknown>)) {
    if (!block || typeof block !== "object" || Array.isArray(block)) continue;
    for (const [name, sensor] of Object.entries(block as Record<string, unknown>)) {
      if (!sensor || typeof sensor !== "object" || Array.isArray(sensor)) continue;
      const rec = sensor as Record<string, unknown>;
      const input = Object.entries(rec).find(([key]) => key.endsWith("_input"));
      const celsius = celsiusFromUnknown(input?.[1] ?? rec.temp ?? rec.temperature);
      if (celsius == null) continue;
      best = preferReading(best, { celsius, label: name });
    }
  }
  return best;
}

export function cpuTempFromNodeStatus(status: unknown): CpuTempReading | null {
  if (!status || typeof status !== "object") return null;
  const rec = status as Record<string, unknown>;
  const direct = celsiusFromUnknown(rec.temperature ?? rec.cpu_temp ?? rec.cputemp);
  if (direct != null) return { celsius: direct, label: "CPU" };
  if (rec.thermalstate != null) return cpuTempFromSensorsJson(rec.thermalstate);
  return null;
}

export function applyCpuTempWatchState(
  notified: boolean,
  celsius: number,
  alertAt = CPU_TEMP_ALERT_CELSIUS,
  clearAt = CPU_TEMP_CLEAR_CELSIUS,
): { notify: boolean; notified: boolean } {
  return applyDiskWatchState(notified, celsius, alertAt, clearAt);
}

export function cpuTempKey(hostId: string, node: string): string {
  return `${hostId}:${node}`;
}
