import type { MetadataRoute } from "next";

// Allow public marketplace discovery while keeping private and legacy surfaces out.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/admin",
        "/api",
        "/affiliate",
        "/portfolio",
        "/wallet",
        "/settings",
        "/onboarding",
        "/bots/manage",
        "/r/",
        "/terminal",
        "/trades",
        "/dashboard",
        "/holdings",
        "/orders",
        "/search",
        "/explorer",
        "/trenches",
        "/alpha",
        "/watchlist",
        "/calls",
        "/alerts",
        "/tracker",
        "/demo",
        "/tools/"
      ]
    },
    sitemap: "https://degenaration.vercel.app/sitemap.xml"
  };
}
