"use client";

import { useEffect, useRef } from "react";
import { ProgressBar } from "@/components/ui/misc";
import { parseProxmoxTaskProgress } from "@/lib/backup";

export function ProxmoxTaskProgress({
  lines,
  running,
  fallbackDetail,
}: {
  lines: string[];
  running: boolean;
  fallbackDetail?: string;
}) {
  const ref = useRef<HTMLPreElement>(null);
  const { percent, detail } = parseProxmoxTaskProgress(lines);
  const shown = percent ?? (running ? 8 : 0);

  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines.length, detail]);

  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between gap-3 text-xs">
        <span className="min-w-0 truncate text-muted-foreground">{detail || fallbackDetail || "…"}</span>
        <span className="shrink-0 tabular-nums text-foreground">{percent != null ? `${Math.round(percent)}%` : running ? "…" : ""}</span>
      </div>
      <ProgressBar value={shown} autoTone={false} className="h-2" />
      <pre
        ref={ref}
        className="max-h-56 overflow-auto whitespace-pre-wrap break-all rounded-[4px] border border-border bg-black/40 p-3 font-mono text-[11px] leading-relaxed text-muted-foreground"
      >
        {lines.join("\n") || fallbackDetail || "…"}
      </pre>
    </div>
  );
}
