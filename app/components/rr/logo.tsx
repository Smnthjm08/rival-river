import { cn } from "@/lib/utils";

/** The two-river mark: brass above, river below. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={cn("size-9", className)} role="img" aria-label="Rival River">
      <rect x="1.5" y="1.5" width="45" height="45" rx="12" fill="var(--felt)" stroke="var(--brass)" strokeWidth="3" />
      <path d="M9 20 Q 15 14 21 20 T 33 20 T 45 20" fill="none" stroke="var(--brass)" strokeWidth="3.2" strokeLinecap="round" />
      <path d="M3 30 Q 9 24 15 30 T 27 30 T 39 30" fill="none" stroke="var(--river)" strokeWidth="3.2" strokeLinecap="round" />
    </svg>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("flex items-center gap-3", className)}>
      <LogoMark />
      <span className="font-heading text-2xl font-extrabold tracking-tight">Rival River</span>
    </span>
  );
}
