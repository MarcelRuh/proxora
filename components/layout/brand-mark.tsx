export function BrandMark({ className = "h-10 w-10" }: { className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src="/brand/proxora-icon.png" alt="" className={`shrink-0 object-contain ${className}`} aria-hidden />
  );
}
