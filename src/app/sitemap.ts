import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

// The public, indexable pages. Member profiles and share links are reached by link, not listed.
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: SITE_URL, changeFrequency: "weekly", priority: 1 },
    { url: `${SITE_URL}/map`, changeFrequency: "daily", priority: 0.8 },
    { url: `${SITE_URL}/docs.md`, changeFrequency: "monthly", priority: 0.4 },
  ];
}
