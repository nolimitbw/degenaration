import type { MetadataRoute } from "next";

// Makes the app installable (PWA) with brand colors.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Degenaration - Solana trading terminal",
    short_name: "Degenaration",
    description: "Live Solana market research, measured call sources, wallet tracking, and wallet-signed trading.",
    start_url: "/",
    display: "standalone",
    background_color: "#0d0e0f",
    theme_color: "#b98b5d",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }]
  };
}
