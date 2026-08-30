"use client";

import { cn } from "@/lib/utils";
import { useI18n } from "@/components/i18n/locale-provider";

function FlagDe({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 12" className={className} aria-hidden>
      <rect width="16" height="4" fill="#000" />
      <rect y="4" width="16" height="4" fill="#dd0000" />
      <rect y="8" width="16" height="4" fill="#ffce00" />
    </svg>
  );
}

function FlagGb({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 12" className={className} aria-hidden>
      <rect width="16" height="12" fill="#012169" />
      <path d="M0 0h16v12H0z" fill="#012169" />
      <path d="M0 0l16 12M16 0L0 12" stroke="#fff" strokeWidth="2.4" />
      <path d="M0 0l16 12M16 0L0 12" stroke="#c8102e" strokeWidth="1.2" />
      <path d="M8 0v12M0 6h16" stroke="#fff" strokeWidth="4" />
      <path d="M8 0v12M0 6h16" stroke="#c8102e" strokeWidth="2" />
    </svg>
  );
}

export function LocaleSwitch({ className }: { className?: string }) {
  const { locale, setLocale } = useI18n();
  const btn =
    "inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider";
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <button
        type="button"
        className={cn(btn, locale === "de" ? "text-primary" : "text-muted-foreground hover:text-foreground")}
        onClick={() => setLocale("de")}
      >
        <FlagDe className="h-3 w-4 rounded-[1px] ring-1 ring-black/20" />
        DE
      </button>
      <span className="text-muted-foreground">/</span>
      <button
        type="button"
        className={cn(btn, locale === "en" ? "text-primary" : "text-muted-foreground hover:text-foreground")}
        onClick={() => setLocale("en")}
      >
        <FlagGb className="h-3 w-4 rounded-[1px] ring-1 ring-black/20" />
        EN
      </button>
    </div>
  );
}
