import type { MetadataRoute } from "next";

// Allow indexing of public pages; keep account/admin surfaces out of search results.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/admin", "/dashboard", "/wallet", "/holdings", "/orders", "/settings"]
    },
    sitemap: "https://degenaration.vercel.app/sitemap.xml"
  };
}
