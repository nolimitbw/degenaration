import type { Metadata } from "next";
import { Space_Grotesk, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import Providers from "@/components/Providers";
import { ToastProvider } from "@/components/Toast";
import ReleaseBanner from "@/components/ReleaseBanner";
import DegenBackdrop from "@/components/DegenBackdrop";

const display = Space_Grotesk({ subsets: ["latin"], variable: "--font-display" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono" });

export const metadata: Metadata = {
  metadataBase: new URL("https://degenaration.vercel.app"),
  title: { default: "DegenAration | Solana Bot Automation", template: "%s | DegenAration" },
  description:
    "Build Solana automation from reviewed Discord sources or live KOL market rules, then track positions, fees, creator commissions, and payouts.",
  keywords: ["Solana", "memecoin", "trading bots", "Discord calls", "KOL bot", "wallet portfolio"],
  openGraph: {
    title: "DegenAration | Solana Bot Automation",
    description: "Discord and KOL bot automation with measured performance, bounded risk, creator commissions, and portfolio evidence.",
    url: "https://degenaration.vercel.app", siteName: "DegenAration", type: "website"
  },
  twitter: { card: "summary_large_image", title: "DegenAration", description: "Solana Discord and KOL bot automation with measured risk and portfolio evidence." }
};

// Render pages on-demand instead of pre-rendering at build time. These are interactive
// wallet/auth apps whose providers must not run during the build (prevents build hangs).
export const dynamic = "force-dynamic";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${display.variable} ${mono.variable} font-display antialiased`}>
        <DegenBackdrop />
        <Providers>
          <ToastProvider>
            <a href="#main-content" className="fixed left-3 top-3 z-[100] -translate-y-20 rounded-md bg-toxic px-4 py-2 text-sm font-semibold text-[#17110c] transition focus:translate-y-0">
              Skip to content
            </a>
            <ReleaseBanner />
            {children}
          </ToastProvider>
        </Providers>
      </body>
    </html>
  );
}
