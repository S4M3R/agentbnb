import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  // Phones in dev: Cloudflare quick tunnels (`cloudflared tunnel --url http://localhost:3000`) and the
  // laptop's address on the local network. Dev-only; production ignores this.
  allowedDevOrigins: ["*.trycloudflare.com", "10.104.3.64", "*.local"],
  partialPrefetching: true,
  // Stagehand reads its browser extension from its own package at runtime and uploads it to
  // Browserbase, so it can't be bundled and the archive must ship with the routes that run browsers.
  serverExternalPackages: ["@browserbasehq/stagehand"],
  outputFileTracingIncludes: {
    "/api/hosting/publications/**": ["./node_modules/@browserbasehq/stagehand/dist/assets/**"],
    "/api/applications/run": ["./node_modules/@browserbasehq/stagehand/dist/assets/**"],
    // Fonts for the share links' generated preview images.
    "/s/**": ["./assets/fonts/**"],
  },
  // Dev design screens still show Unsplash photos through next/image; the live home serves its own.
  images: {
    remotePatterns: [new URL("https://images.unsplash.com/**")],
  },
  // Files in /public aren't content-hashed, so Next serves them with max-age=0. These folders change
  // rarely: let browsers keep them a day and reuse a stale copy for a week while they refresh.
  async headers() {
    return ["/icons/:path*", "/favicons/:path*", "/agents/:path*", "/starters/:path*", "/og/:path*"].map((source) => ({
      source,
      headers: [{ key: "Cache-Control", value: "public, max-age=86400, stale-while-revalidate=604800" }],
    }));
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
