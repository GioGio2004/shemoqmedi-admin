// Listing taxonomy: the single source of truth for categories, technologies,
// regions, creator tiers, awards and score pillars. The public site keeps a
// copy in lib/taxonomy.ts — keep the two files identical.

export const CATEGORIES = [
  { slug: "portfolio", name: "Portfolio" },
  { slug: "agency", name: "Agency" },
  { slug: "e-commerce", name: "E-Commerce" },
  { slug: "saas", name: "SaaS" },
  { slug: "ai", name: "AI" },
  { slug: "fintech", name: "Fintech" },
  { slug: "hospitality", name: "Hospitality" },
  { slug: "architecture", name: "Architecture" },
  { slug: "editorial", name: "Editorial" },
  { slug: "fashion", name: "Fashion" },
  { slug: "culture", name: "Culture" },
  { slug: "photography", name: "Photography" },
  { slug: "music", name: "Music & Sound" },
  { slug: "real-estate", name: "Real Estate" },
  { slug: "food-drink", name: "Food & Drink" },
  { slug: "health", name: "Health & Wellness" },
  { slug: "education", name: "Education" },
  { slug: "games", name: "Games & Entertainment" },
  { slug: "travel", name: "Travel" },
  { slug: "other", name: "Other" },
] as const;

/** `slug` is used in /collections/<slug> URLs. */
export const TECHNOLOGIES = [
  { slug: "nextjs", name: "Next.js" },
  { slug: "react", name: "React" },
  { slug: "typescript", name: "TypeScript" },
  { slug: "vue", name: "Vue" },
  { slug: "nuxt", name: "Nuxt" },
  { slug: "svelte", name: "Svelte" },
  { slug: "astro", name: "Astro" },
  { slug: "webflow", name: "Webflow" },
  { slug: "framer", name: "Framer" },
  { slug: "wordpress", name: "WordPress" },
  { slug: "shopify", name: "Shopify" },
  { slug: "tailwind", name: "Tailwind" },
  { slug: "gsap", name: "GSAP" },
  { slug: "motion", name: "Motion" },
  { slug: "threejs", name: "Three.js" },
  { slug: "webgl", name: "WebGL" },
  { slug: "lenis", name: "Lenis" },
  { slug: "convex", name: "Convex" },
  { slug: "ai", name: "AI" },
  { slug: "mcp", name: "MCP" },
  { slug: "custom-cms", name: "Custom CMS" },
  { slug: "custom-audio", name: "Custom Audio" },
] as const;

export const REGIONS = [
  { slug: "georgia", name: "Georgia" },
  { slug: "global", name: "Global" },
] as const;

export const CREATOR_TIERS = [
  { slug: "solo", name: "Solo developer", badge: "Solo dev" },
  { slug: "agency", name: "Agency / team", badge: "Agency" },
] as const;

export const AWARDS = [
  { slug: "SOTD", name: "Site of the Day", short: "SOTD" },
  { slug: "BSC", name: "Best Solo Creation", short: "BSC" },
  { slug: "HM", name: "Honorable Mention", short: "HM" },
] as const;

export const PILLARS = [
  { key: "design", name: "Design" },
  { key: "usability", name: "Usability" },
  { key: "creativity", name: "Creativity" },
  { key: "code", name: "Code" },
] as const;

export type CategorySlug = (typeof CATEGORIES)[number]["slug"];
export type TechnologyName = (typeof TECHNOLOGIES)[number]["name"];
export type RegionSlug = (typeof REGIONS)[number]["slug"];
export type CreatorTier = (typeof CREATOR_TIERS)[number]["slug"];
export type AwardSlug = (typeof AWARDS)[number]["slug"];
export type PillarKey = (typeof PILLARS)[number]["key"];

export function isCategory(value: string): value is CategorySlug {
  return CATEGORIES.some((c) => c.slug === value);
}

export function isTechnology(value: string): value is TechnologyName {
  return TECHNOLOGIES.some((t) => t.name === value);
}

export const VOTING_DAYS = 7;
export const DAY_MS = 24 * 60 * 60 * 1000;

export const LIMITS = {
  title: 80,
  tagline: 160,
  /** Public jury note on the listing page (a few sentences). */
  juryNote: 600,
  creditName: 80,
  url: 500,
  technologies: 6,
  /** Categories per listing (the first is the primary one). */
  categories: 3,
  reviewNote: 500,
  claimMessage: 1000,
  /** Extra screenshots after the cover (so 5 images in all). */
  gallery: 4,
  /** Max screenshot size in bytes. */
  imageBytes: 5 * 1024 * 1024,
  /** Max hover-video size in bytes. */
  videoBytes: 10 * 1024 * 1024,
  /** Max listings one user can have waiting for review at once. */
  pendingPerUser: 5,
  /** Max URLs per admin import batch. */
  importBatch: 10,
} as const;
