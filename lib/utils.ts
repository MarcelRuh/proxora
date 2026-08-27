import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function bytesToSize(bytes: number | undefined | null, decimals = 1): string {
  if (bytes === undefined || bytes === null || Number.isNaN(bytes)) return "—";
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB", "PB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const n = bytes / k ** i;
  return `${n.toLocaleString("de-DE", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })} ${sizes[i]}`;
}

export function formatPercent(value: number, digits = 1): string {
  return `${value.toLocaleString("de-DE", { minimumFractionDigits: digits, maximumFractionDigits: digits })} %`;
}

export function formatUptime(seconds: number | undefined | null): string {
  if (!seconds || seconds < 0) return "—";
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export function percentage(used: number | undefined, total: number | undefined): number {
  if (!total || !used) return 0;
  return Math.min(100, Math.round((used / total) * 1000) / 10);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isBrowser(): boolean {
  return typeof window !== "undefined";
}
