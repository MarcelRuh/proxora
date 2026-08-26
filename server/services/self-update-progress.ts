import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export type SelfUpdateProgress = {
  percent: number;
  step: string;
  detail: string | null;
};

export const PROGRESS_FILE = ".proxora-update-progress";
export const REVISION_FILE = ".proxora-revision";

const LOG_RULES: Array<{ test: RegExp; percent: number; step: string }> = [
  { test: /==> Proxora self-update/i, percent: 4, step: "start" },
  { test: /Resolving remote/i, percent: 8, step: "resolve" },
  { test: /remote=[a-f0-9]/i, percent: 12, step: "resolve" },
  { test: /Downloading source tarball/i, percent: 16, step: "sync" },
  { test: /Syncing files|Git sync complete|git already at/i, percent: 22, step: "sync" },
  { test: /Rebuilding stack/i, percent: 28, step: "build" },
  { test: /proxora Building|Building proxora|Building web/i, percent: 42, step: "buildWeb" },
  { test: /Compiled successfully/i, percent: 64, step: "buildWeb" },
  { test: /exporting to image/i, percent: 72, step: "export" },
  { test: /Image proxora Built|naming to .*proxora/i, percent: 80, step: "buildWeb" },
  { test: /Container proxora\s+Started/i, percent: 90, step: "startWeb" },
  { test: /Container proxora\s+Healthy/i, percent: 94, step: "startWeb" },
  { test: /wrote \.proxora-revision/i, percent: 96, step: "finalize" },
  { test: /Done\. Proxora should come back/i, percent: 100, step: "done" },
];

export function parseProgressFile(raw: string): SelfUpdateProgress | null {
  const percentMatch = /^percent=(\d{1,3})\s*$/m.exec(raw);
  const stepMatch = /^step=([A-Za-z0-9_-]+)\s*$/m.exec(raw);
  if (!percentMatch?.[1] || !stepMatch?.[1]) return null;
  const percent = Math.min(100, Math.max(0, Number(percentMatch[1])));
  if (!Number.isFinite(percent)) return null;
  const detailMatch = /^detail=(.*)$/m.exec(raw);
  return { percent, step: stepMatch[1], detail: detailMatch?.[1]?.trim() || null };
}

const EXPLICIT = /^==>\s*\[(\d{1,3})%\]\s+([A-Za-z0-9_-]+)/;

function consider(current: SelfUpdateProgress | null, next: SelfUpdateProgress): SelfUpdateProgress {
  if (!current || next.percent >= current.percent) return next;
  return current;
}

export function parseUpdaterLogs(logs: string): SelfUpdateProgress | null {
  let current: SelfUpdateProgress | null = null;
  for (const line of logs.split(/\r?\n/)) {
    const explicit = EXPLICIT.exec(line);
    if (explicit?.[1] && explicit[2]) {
      current = consider(current, {
        percent: Math.min(100, Number(explicit[1])),
        step: explicit[2],
        detail: line.trim().slice(0, 160),
      });
      continue;
    }
    for (const rule of LOG_RULES) {
      if (rule.test.test(line)) {
        current = consider(current, {
          percent: rule.percent,
          step: rule.step,
          detail: line.trim().slice(0, 160),
        });
      }
    }
  }
  return current;
}

export function mergeProgress(
  file: SelfUpdateProgress | null,
  logs: SelfUpdateProgress | null,
): SelfUpdateProgress | null {
  if (file?.step === "done" && file.percent >= 100 && logs && logs.percent < 100) return logs;
  if (!file) return logs;
  if (!logs) return file;
  return logs.percent >= file.percent ? logs : file;
}

export function readProgressFromDir(dir: string | null): SelfUpdateProgress | null {
  if (!dir) return null;
  const file = path.join(dir, PROGRESS_FILE);
  if (!existsSync(file)) return null;
  try {
    return parseProgressFile(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}
