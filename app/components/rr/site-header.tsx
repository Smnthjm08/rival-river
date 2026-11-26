import Link from "next/link";
import { Logo } from "@/components/rr/logo";
import { WalletButton } from "@/components/rr/wallet-button";
import { cn } from "@/lib/utils";

/**
 * One bar: logo left; the table's status (if any) and the wallet right.
 * `quiet` keeps brass for the screen's own main action.
 */
export function SiteHeader({ children, quiet }: { children?: React.ReactNode; quiet?: boolean }) {
  return (
    <header className="flex h-(--header-h) shrink-0 items-center gap-2 border-b px-3 sm:gap-4 sm:px-6">
      <Link href="/" aria-label="Rival River home" className="flex min-h-11 min-w-11 shrink-0 items-center rounded-lg">
        {/* On a table, a narrow screen keeps the mark and gives the words' room to the status. */}
        <Logo className={cn("gap-2.5 [&>span]:text-xl", children && "max-lg:[&>span]:sr-only")} />
      </Link>
      <div className="ml-auto flex min-w-0 items-center gap-3 sm:gap-5">
        {children}
        <WalletButton compact quiet={quiet} />
      </div>
    </header>
  );
}
