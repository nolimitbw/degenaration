import type { Metadata } from "next";
import { Archivo, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import Providers from "@/components/Providers";
import { ToastProvider } from "@/components/Toast";
import { ReadinessProvider } from "@/components/product/Readiness";
import DegenBackdrop from "@/components/DegenBackdrop";
import { ThemeProvider } from "@/components/ThemeProvider";

// Archivo carries the interface: a grotesque with tight apertures and a real weight range,
// so hierarchy comes from weight and size rather than from decoration.
//
// Plex Mono is deliberately narrow in scope. Monospace here means one thing — a string the
// machine produced and the user may need to compare character by character: a wallet address,
// a signature, a mint, a version tag. It is not a label style. Applying it to every caption is
// what made the old interface read as generated rather than designed.
const display = Archivo({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-display" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-mono" });

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
            <ReadinessProvider>{children}</ReadinessProvider>
            </ToastProvider>
          </Providers>
        </ThemeProvider>
      </body>
    </html>
  );
}
