import { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      disallow: "/", // Completely kills Google crawling the entire admin domain
    },
  };
}
