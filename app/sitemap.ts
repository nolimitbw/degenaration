import type { MetadataRoute } from "next";

const BASE = "https://degenaration.vercel.app";

// Public, indexable product and policy routes only.
export default function sitemap(): MetadataRoute.Sitemap {
  const routes = ["", "/bots", "/bots/discord", "/bots/kol", "/apply", "/terms", "/privacy", "/security", "/docs"];
  return routes.map((path) => ({
    url: `${BASE}${path}`,
    changeFrequency: path === "" || path.startsWith("/bots") ? "hourly" : "weekly",
    priority: path === "" ? 1 : 0.7
  }));
}
