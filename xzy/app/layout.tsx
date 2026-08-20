import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Xzy",
  description: "Copy trading for Telegram calls, on Solana."
};

export const viewport: Viewport = {
  themeColor: "#080808",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/*
          Telegram's Mini App bridge. It must come from Telegram's origin and load
          before the app reads window.Telegram, so it is a plain blocking script
          rather than next/script.
        */}
        <script src="https://telegram.org/js/telegram-web-app.js" />
      </head>
      <body className="bg-base text-ink font-sans antialiased">{children}</body>
    </html>
  );
}
