import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function ProgressBar({
  value,
  className,
  autoTone = true,
  tone = "primary",
}: {
  value: number;
  className?: string;
  autoTone?: boolean;
  tone?: "primary" | "warning" | "danger";
}) {
  const clamped = Math.max(0, Math.min(100, value));
  const color = autoTone
    ? clamped >= 90
      ? "bg-danger"
      : clamped >= 75
        ? "bg-warning"
        : "bg-gradient-to-r from-[#ff006e] to-[#8338ec]"
    : tone === "danger"
      ? "bg-danger"
      : tone === "warning"
        ? "bg-warning"
        : "bg-gradient-to-r from-[#ff006e] to-[#8338ec]";
  return (
    <div className={cn("h-1.5 w-full overflow-hidden rounded-full bg-white/[0.06]", className)}>
      <div
        className={cn("h-full rounded-full transition-all", color)}
        style={{ width: `${clamped}%`, boxShadow: "0 0 12px rgba(255,0,110,0.4)" }}
      />
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-md bg-muted", className)} />;
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-[4px] border border-dashed border-border px-6 py-16 text-center">
      <p className="text-sm font-medium">{title}</p>
      {description ? <p className="max-w-md text-sm text-muted-foreground">{description}</p> : null}
      {action}
    </div>
  );
}
