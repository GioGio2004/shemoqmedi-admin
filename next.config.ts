import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Verification builds can be pointed elsewhere with NEXT_BUILD_DIR so a
  // `next build` never churns the `.next` directory a running `next dev`
  // is reading (that collision throws transient 404s in the dev server).
  // Unset = ".next", so deploys are unaffected.
  distDir: process.env.NEXT_BUILD_DIR || ".next",
  async redirects() {
    return [
      // The admin used to be localized under /en, /ka and /ru. English only now.
      { source: "/:locale(en|ka|ru)", destination: "/", permanent: true },
      { source: "/:locale(en|ka|ru)/:path*", destination: "/:path*", permanent: true },
    ];
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "ik.imagekit.io" },
      { protocol: "https", hostname: "img.clerk.com" },
      { protocol: "https", hostname: "*.convex.cloud" },
    ],
  },
};

export default nextConfig;
