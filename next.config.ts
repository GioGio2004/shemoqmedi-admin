import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./i18n.ts");
const nextConfig: NextConfig = {
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
