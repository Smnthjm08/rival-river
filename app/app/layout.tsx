import type { Metadata } from "next";
import { Bricolage_Grotesque, Inter, JetBrains_Mono } from "next/font/google";
import { Providers } from "@/components/providers";
import { cn } from "@/lib/utils";
import "./globals.css";

// Kit type: Bricolage for headings, card ranks and big numbers; Inter for
// everything you read; JetBrains Mono for chips, amounts and wallets.
const heading = Bricolage_Grotesque({ subsets: ["latin"], variable: "--font-heading" });
const sans = Inter({ subsets: ["latin"], variable: "--font-sans" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono" });

export const metadata: Metadata = {
  title: "Rival River",
  description: "Heads-up hold’em with a friend. Both stake USDC, cards stay sealed until showdown, the winner takes both.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={cn("dark h-full antialiased", heading.variable, sans.variable, mono.variable)}>
      <body className="flex min-h-full flex-col">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
