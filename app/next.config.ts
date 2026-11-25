import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  experimental: {
    agentFeedback: true,
  },
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    // @anchor-lang/core's browser build still mentions `fs` (NodeWallet, never
    // used here); give the browser an empty module instead.
    resolveAlias: {
      fs: { browser: "./lib/shims/empty.js" },
    },
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
