// Listing taxonomy: the single source of truth for categories and
// technologies. The public site keeps a copy in lib/taxonomy.ts — keep the
// two lists identical.

export const CATEGORIES = [
  { slug: "portfolio", name: "Portfolio" },
  { slug: "agency", name: "Agency" },
  { slug: "e-commerce", name: "E-commerce" },
  { slug: "saas", name: "SaaS" },
  { slug: "ai", name: "AI" },
  { slug: "editorial", name: "Editorial" },
  { slug: "architecture", name: "Architecture" },
  { slug: "fashion", name: "Fashion" },
  { slug: "culture", name: "Culture" },
  { slug: "other", name: "Other" },
] as const;

export const TECHNOLOGIES = [
  "Next.js",
  "React",
  "Vue",
  "Nuxt",
  "Svelte",
  "Astro",
  "Webflow",
  "Framer",
  "WordPress",
  "Shopify",
  "Tailwind",
  "GSAP",
  "Three.js",
  "WebGL",
  "Lenis",
  "Convex",
] as const;

export type CategorySlug = (typeof CATEGORIES)[number]["slug"];

export function isCategory(value: string): value is CategorySlug {
  return CATEGORIES.some((c) => c.slug === value);
}

export function isTechnology(value: string): boolean {
  return (TECHNOLOGIES as readonly string[]).includes(value);
}

export const LIMITS = {
  title: 80,
  tagline: 160,
  creditName: 80,
  url: 500,
  technologies: 6,
  reviewNote: 500,
  /** Max screenshot size in bytes. */
  imageBytes: 5 * 1024 * 1024,
  /** Max listings one user can have waiting for review at once. */
  pendingPerUser: 5,
} as const;
