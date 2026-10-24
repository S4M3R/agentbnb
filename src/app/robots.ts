import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

// Crawl the public pages; keep crawlers out of the API, dev screens and members' private pages.
// Share links (/s/...) stay crawlable so link-preview bots can read them; they're noindex instead.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/api/", "/dev/", "/me/", "/applications", "/hosting", "/requests"],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
