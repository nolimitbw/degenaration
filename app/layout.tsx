import type { Metadata } from "next";
import { Space_Grotesk, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import Providers from "@/components/Providers";
import { ToastProvider } from "@/components/Toast";
import ReleaseBanner from "@/components/ReleaseBanner";
import DegenBackdrop from "@/components/DegenBackdrop";
import { ThemeProvider } from "@/components/ThemeProvider";

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
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: `(function(){try{var p=localStorage.getItem('degenaration-theme')||'system';if(!/^(light|dark|system)$/.test(p))p='system';var t=p==='system'?(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'):p;document.documentElement.dataset.theme=t;document.documentElement.dataset.themePreference=p;document.documentElement.style.colorScheme=t}catch(e){document.documentElement.dataset.theme='dark'}})();` }} />
      </head>
      <body className={`${display.variable} ${mono.variable} font-display antialiased`}>
        <DegenBackdrop />
        <ThemeProvider>
          <Providers>
            <ToastProvider>
            {/* min-h-11: it is off-screen until focused, but once focused it is a real control
                and was 36px tall, under the 44px minimum every other target here holds to. */}
            <a href="#main-content" className="fixed left-3 top-3 z-[100] inline-flex min-h-11 -translate-y-20 items-center rounded-md bg-gold-400 px-4 py-2 text-sm font-semibold text-[#17110c] transition focus:translate-y-0">
              Skip to content
            </a>
            <ReleaseBanner />
              {children}
            </ToastProvider>
          </Providers>
        </ThemeProvider>
      </body>
    </html>
  );
}
