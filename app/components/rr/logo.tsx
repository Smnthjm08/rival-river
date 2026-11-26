import { cn } from "@/lib/utils";

/**
 * The river spade: a spade divided by the river, brass above and river below.
 * app/icon.svg, favicon.ico and apple-icon.png draw the same shape.
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={cn("size-9", className)} role="img" aria-label="Rival River">
      <rect width="48" height="48" rx="11" fill="var(--felt)" />
      <path fill="var(--brass)" d="M24 5.1C27.69 11.1 37.33 16.33 40.03 23.46C34.8 27.24 29.94 27.24 24 23.46C18.06 19.68 13.2 19.68 7.97 23.46C10.67 16.33 20.31 11.1 24 5.1Z" />
      <path fill="var(--river)" d="M7.26 27.24C12.66 23.46 18.06 23.46 24 27.24C29.94 31.02 35.34 31.02 40.74 27.24C40.74 32.21 36.96 35.66 32.42 35.66C29.62 35.66 27.46 34.48 26.05 32.53C26.38 36.53 28.1 39.98 31.02 42.9H16.98C19.9 39.98 21.62 36.53 21.95 32.53C20.54 34.48 18.38 35.66 15.58 35.66C11.04 35.66 7.26 32.21 7.26 27.24Z" />
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
