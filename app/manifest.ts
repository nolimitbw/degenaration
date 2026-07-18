import type { MetadataRoute } from "next";

// Makes the app installable (PWA) with brand colors.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Degenaration — On-chain trading terminal",
    short_name: "Degenaration",
    description: "Live trenches, token screener, pro charts and non-custodial auto-trading on Solana.",
    start_url: "/",
    display: "standalone",
    background_color: "#0d0e0f",
    theme_color: "#b98b5d",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }]
  };
}
