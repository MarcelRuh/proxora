"use client";

import { useId } from "react";

export function BrandMark({ className = "h-10 w-10" }: { className?: string }) {
  const id = useId();
  return (
    <svg viewBox="0 0 40 40" className={className} aria-hidden>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="var(--proxora-pink)" />
          <stop offset="55%" stopColor="var(--proxora-purple)" />
          <stop offset="100%" stopColor="var(--proxora-blue)" />
        </linearGradient>
      </defs>
      <polygon
        points="20,2 37,11.5 37,28.5 20,38 3,28.5 3,11.5"
        fill="color-mix(in srgb, var(--proxora-pink) 12%, transparent)"
        stroke={`url(#${id})`}
        strokeWidth="1.6"
      />
      <rect x="13" y="15" width="14" height="11" rx="1.2" fill="none" stroke={`url(#${id})`} strokeWidth="1.4" />
      <path d="M16 15v-2h8v2" fill="none" stroke={`url(#${id})`} strokeWidth="1.4" />
    </svg>
  );
}

