import type { MetadataRoute } from "next";

// Allow public marketplace discovery while keeping private surfaces out.
//
// The legacy trading surfaces are no longer listed here: they now redirect to the product
// (spec section 9), so a crawler that follows one lands on /bots. Listing a redirect as
// disallowed only hides the redirect.
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
        "/calls",
        "/tools/"
      ]
    },
    sitemap: "https://degenaration.vercel.app/sitemap.xml"
  };
}
