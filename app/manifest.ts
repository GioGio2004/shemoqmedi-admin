import type { MetadataRoute } from "next";
import { headers } from "next/headers";
import { isStudioHost } from "@/lib/hosts";

// One Next app, two installable apps: the Studio and the admin. Reading the
// Host header makes this manifest per request, so each host installs as its
// own app with its own name and start page (proxy.ts never runs for
// /manifest.webmanifest, so it is served without a session as browsers need).

const ICONS: MetadataRoute.Manifest["icons"] = [
  { src: "/icons/crow-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
  { src: "/icons/crow-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
  // The crow inside the safe zone, for Android's round and squircle masks
  // (scripts/pwa-icons.mjs).
  { src: "/icons/crow-maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
  { src: "/icons/crow-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
];

const COMMON = {
  id: "/",
  scope: "/",
  display: "standalone",
  theme_color: "#ffffff",
  background_color: "#ffffff",
  icons: ICONS,
} satisfies MetadataRoute.Manifest;

export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const host = (await headers()).get("host");
  if (isStudioHost(host)) {
    return {
      ...COMMON,
      name: "Shemoqmedi Studio",
      short_name: "Studio",
      description: "Design, schedule and publish Shemoqmedi's social posts.",
      start_url: "/",
    };
  }
  return {
    ...COMMON,
    name: "Shemoqmedi Admin",
    short_name: "Admin",
    description: "Review, awards and curation for shemoqmedi.space.",
    // Signed in, "/" only redirects here; starting here saves the hop.
    start_url: "/dashboard",
  };
}
