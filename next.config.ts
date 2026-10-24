import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  // Stagehand reads its browser extension from its own package at runtime and uploads it to
  // Browserbase, so it can't be bundled and the archive must ship with the routes that run browsers.
  serverExternalPackages: ["@browserbasehq/stagehand"],
  outputFileTracingIncludes: {
    "/api/hosting/publications/**": ["./node_modules/@browserbasehq/stagehand/dist/assets/**"],
    "/api/applications/run": ["./node_modules/@browserbasehq/stagehand/dist/assets/**"],
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
