import type { NextConfig } from "next";
import createMDX from "@next/mdx";

/** Sent with every response of this app (admin, Studio, docs). */
export const SECURITY_HEADERS = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "Permissions-Policy", value: "camera=(), geolocation=(), microphone=(self)" },
];

const nextConfig: NextConfig = {
  // Verification builds can be pointed elsewhere with NEXT_BUILD_DIR so a
  // `next build` never churns the `.next` directory a running `next dev`
  // is reading (that collision throws transient 404s in the dev server).
  // Unset = ".next", so deploys are unaffected.
  distDir: process.env.NEXT_BUILD_DIR || ".next",
  experimental: {
    // Turbopack's on-disk dev cache survives restarts and has kept stale
    // route tables on Windows after files changed under a running server
    // (pages 404ing until .next was deleted). Correct routes beat a faster
    // cold start.
    turbopackFileSystemCacheForDev: false,
  },
  async headers() {
    return [
      {
        // Every page of the admin, Studio and docs. frame-ancestors 'none' (and
        // X-Frame-Options for old browsers) stops other sites from loading the
        // admin in a hidden frame and tricking a signed-in admin into clicking
        // approve, publish or delete (clickjacking).
        source: "/:path*",
        headers: SECURITY_HEADERS,
      },
      {
        // The service worker (push for the Studio and admin PWAs). Never
        // cached, so a fix reaches every installed app on its next visit,
        // and limited to its own origin.
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self'" },
        ],
      },
    ];
  },
  async redirects() {
    return [
      // The admin used to be localized under /en, /ka and /ru. English only now.
      { source: "/:locale(en|ka|ru)", destination: "/", permanent: true },
      { source: "/:locale(en|ka|ru)/:path*", destination: "/:path*", permanent: true },
    ];
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "img.clerk.com" },
      { protocol: "https", hostname: "*.convex.cloud" },
      { protocol: "https", hostname: "ik.imagekit.io", pathname: "/shemoqmedi/**" },
    ],
  },
};

// The team docs are MDX files in content/docs (app/docs renders them).
// Plugins are named as strings so Turbopack can load them.
const withMDX = createMDX({
  options: { remarkPlugins: [["remark-gfm", {}]] },
});

export default withMDX(nextConfig);
