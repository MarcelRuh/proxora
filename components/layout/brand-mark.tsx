"use client";

import { useId } from "react";

export function BrandMark({ className = "h-10 w-10" }: { className?: string }) {
  const id = useId();
  return (
    <svg viewBox="0 0 40 40" className={className} aria-hidden>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#ff006e" />
          <stop offset="55%" stopColor="#8338ec" />
          <stop offset="100%" stopColor="#00b4d8" />
        </linearGradient>
      </defs>
      <polygon
        points="20,2 37,11.5 37,28.5 20,38 3,28.5 3,11.5"
        fill="rgba(255,0,110,0.12)"
        stroke={`url(#${id})`}
        strokeWidth="1.6"
      />
      <rect x="13" y="15" width="14" height="11" rx="1.2" fill="none" stroke={`url(#${id})`} strokeWidth="1.4" />
      <path d="M16 15v-2h8v2" fill="none" stroke={`url(#${id})`} strokeWidth="1.4" />
    </svg>
  );
}

