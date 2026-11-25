import Link from "next/link";
import { Logo } from "@/components/rr/logo";
import { WalletButton } from "@/components/rr/wallet-button";

/** Logo left; status pills (if any) and the wallet right. Wraps on phones. */
export function SiteHeader({ children }: { children?: React.ReactNode }) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-4 border-b px-4 py-4 sm:px-8">
      <Link href="/" aria-label="Rival River home">
        <Logo />
      </Link>
      <div className="flex flex-wrap items-center gap-2.5">
        {children}
        <WalletButton />
      </div>
    </header>
  );
}
