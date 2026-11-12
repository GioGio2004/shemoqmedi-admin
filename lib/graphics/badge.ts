import { STOREFRONT_URL } from "@/lib/storefront";

// Where an award graphic's badge comes from. Client-safe: the server render
// (render.ts) rasterises it, the Studio's preview (preview.tsx) shows the
// same URL as an <img>, so both draw the same badge.

/** The storefront's badge art for an award slug (a seal on a light ground), unless an explicit URL is given. */
export function badgeUrlFor(awardSlug: string | undefined, explicit?: string | null) {
  if (explicit) return explicit;
  return awardSlug && /^[a-z0-9-]{3,120}$/.test(awardSlug) ? `${STOREFRONT_URL}/badge/${awardSlug}?shape=seal&theme=light` : null;
}
