import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./i18n.ts");
const nextConfig: NextConfig = {
  // Verification builds can be pointed elsewhere with NEXT_BUILD_DIR so a
  // `next build` never churns the `.next` directory a running `next dev`
  // is reading (that collision throws transient 404s in the dev server).
  // Unset = ".next", so deploys are unaffected.
  distDir: process.env.NEXT_BUILD_DIR || ".next",
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "ik.imagekit.io",
      },
      {
        protocol: "https",
        hostname: "img.clerk.com", // Clerk org logos
      },
      {
        protocol: "https",
        hostname: "*.convex.cloud", // Convex storage
      },
    ],
  },
};

export default withNextIntl(nextConfig);
