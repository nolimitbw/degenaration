import type { MetadataRoute } from "next";

const BASE = "https://degenaration.vercel.app";

// Public, indexable routes only (account/admin pages are excluded via robots).
export default function sitemap(): MetadataRoute.Sitemap {
  const routes = ["", "/trenches", "/explorer", "/tracker", "/watchlist", "/alpha", "/calls", "/apply", "/login", "/terms", "/privacy", "/security", "/docs"];
  return routes.map((path) => ({
    url: `${BASE}${path}`,
    changeFrequency: path === "" || path === "/trenches" || path === "/explorer" ? "hourly" : "weekly",
    priority: path === "" ? 1 : 0.7
  }));
}
