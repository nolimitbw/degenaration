import type { Metadata } from "next";
import { Space_Grotesk, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import Providers from "@/components/Providers";
import { ToastProvider } from "@/components/Toast";
import DevnetBanner from "@/components/DevnetBanner";

const display = Space_Grotesk({ subsets: ["latin"], variable: "--font-display" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono" });

export const metadata: Metadata = {
  metadataBase: new URL("https://degenaration.vercel.app"),
  title: { default: "Degenaration — On-chain trading terminal & alpha copy-trading", template: "%s · Degenaration" },
  description:
    "Discover, analyze and copy the best Solana alpha — live trenches, token screener, pro charts, ranked call groups, wallet tracker and non-custodial auto-trading. Your keys, your coins.",
  keywords: ["Solana", "memecoin", "trading terminal", "copy trading", "DexScreener", "alpha", "trenches", "non-custodial"],
  openGraph: {
    title: "Degenaration — On-chain trading terminal & alpha copy-trading",
    description: "Live trenches, token screener, pro charts, ranked alpha groups, wallet tracker and non-custodial auto-trading on Solana.",
    url: "https://degenaration.vercel.app", siteName: "Degenaration", type: "website"
  },
  twitter: { card: "summary_large_image", title: "Degenaration", description: "On-chain trading terminal & alpha copy-trading on Solana." }
};

// Render pages on-demand instead of pre-rendering at build time. These are interactive
// wallet/auth apps whose providers must not run during the build (prevents build hangs).
export const dynamic = "force-dynamic";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${display.variable} ${mono.variable} font-display antialiased`}>
        <Providers>
          <ToastProvider>
            <DevnetBanner />
            {children}
          </ToastProvider>
        </Providers>
      </body>
    </html>
  );
}
