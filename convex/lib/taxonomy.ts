// Listing taxonomy: the single source of truth for categories, technologies,
// regions, creator tiers, awards and score pillars. The public site keeps a
// copy in lib/taxonomy.ts — keep the two files identical.

export const CATEGORIES = [
  // Studios & portfolios
  { slug: "portfolio", name: "Portfolio" },
  { slug: "agency", name: "Agency" },
  { slug: "photography", name: "Photography" },
  { slug: "illustration", name: "Illustration & Art" },
  { slug: "film", name: "Film & Video" },
  { slug: "3d-motion", name: "3D & Motion" },
  { slug: "architecture", name: "Architecture" },
  { slug: "interior", name: "Interior Design" },
  // Product & tech
  { slug: "saas", name: "SaaS" },
  { slug: "ai", name: "AI" },
  { slug: "fintech", name: "Fintech" },
  { slug: "web3", name: "Crypto & Web3" },
  { slug: "dev-tools", name: "Developer Tools" },
  { slug: "apps", name: "Mobile Apps" },
  { slug: "hardware", name: "Hardware & Devices" },
  { slug: "corporate", name: "Business & Corporate" },
  // Brands & shopping
  { slug: "e-commerce", name: "E-Commerce" },
  { slug: "fashion", name: "Fashion" },
  { slug: "beauty", name: "Beauty & Cosmetics" },
  { slug: "food-drink", name: "Food & Drink" },
  { slug: "home-living", name: "Furniture & Home" },
  { slug: "automotive", name: "Automotive" },
  // Places & experiences
  { slug: "hospitality", name: "Hospitality" },
  { slug: "real-estate", name: "Real Estate" },
  { slug: "travel", name: "Travel" },
  { slug: "health", name: "Health & Wellness" },
  { slug: "sports", name: "Sports & Fitness" },
  { slug: "events", name: "Events & Festivals" },
  // Culture & media
  { slug: "editorial", name: "Editorial" },
  { slug: "culture", name: "Culture" },
  { slug: "music", name: "Music & Sound" },
  { slug: "games", name: "Games & Entertainment" },
  { slug: "education", name: "Education" },
  { slug: "institutions", name: "Museums & Institutions" },
  { slug: "nonprofit", name: "Non-profit & Causes" },
  { slug: "experimental", name: "Experimental" },
  { slug: "other", name: "Other" },
] as const;

/**
 * CATEGORIES in groups, for the site's menu and pickers. Every category
 * except "other" is in exactly one group, in CATEGORIES order.
 */
export const CATEGORY_GROUPS = [
  {
    name: "Studios & portfolios",
    slugs: ["portfolio", "agency", "photography", "illustration", "film", "3d-motion", "architecture", "interior"],
  },
  {
    name: "Product & tech",
    slugs: ["saas", "ai", "fintech", "web3", "dev-tools", "apps", "hardware", "corporate"],
  },
  { name: "Brands & shopping", slugs: ["e-commerce", "fashion", "beauty", "food-drink", "home-living", "automotive"] },
  { name: "Places & experiences", slugs: ["hospitality", "real-estate", "travel", "health", "sports", "events"] },
  {
    name: "Culture & media",
    slugs: ["editorial", "culture", "music", "games", "education", "institutions", "nonprofit", "experimental"],
  },
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

/** Highest first. Tiers: SOTY > SOTM > SOTD > HM; BSC is a side award for solo makers. */
export const AWARDS = [
  { slug: "SOTY", name: "Site of the Year", short: "SOTY" },
  { slug: "SOTM", name: "Site of the Month", short: "SOTM" },
  { slug: "SOTD", name: "Site of the Day", short: "SOTD" },
  { slug: "BSC", name: "Best Solo Creation", short: "BSC" },
  { slug: "HM", name: "Honorable Mention", short: "HM" },
  // Honorary: given by hand to the first hundred sites (lib/awards.ts FIRST_100).
  { slug: "F100", name: "First 100", short: "F100" },
] as const;

/** Jury pillars and their weight in the final score. */
export const PILLARS = [
  { key: "design", name: "Design", weight: 0.4 },
  { key: "usability", name: "Usability", weight: 0.3 },
  { key: "creativity", name: "Creativity", weight: 0.2 },
  { key: "content", name: "Content", weight: 0.1 },
] as const;

/** Jury panels. Keep in sync with schema.ts juryCategory. */
export const JURY_CATEGORIES = [
  { slug: "design", name: "Design & UI" },
  { slug: "engineering", name: "Engineering & Performance" },
  { slug: "venture", name: "Venture & Startups" },
  { slug: "academic", name: "Academic, SEO & Content" },
] as const;
export type JuryCategory = (typeof JURY_CATEGORIES)[number]["slug"];

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
  /** Legacy fallback for the admin's jury target; the real minimum is config.minVotes (lib/config.ts). */
  juryMinEvaluations: 3,
  /** Entries in a juror's Experience and Work sections. */
  juryExperience: 8,
  juryWork: 8,
  /** Jury evaluation comment (optional), shown on the listing page. */
  juryComment: 1000,
  /** Juror profile fields. */
  juryTitle: 80,
  juryBio: 400,
  /** Days a jury invitation link stays valid. */
  juryInviteDays: 14,
  /** Profile links on a creator page (Dribbble, LinkedIn, ...). */
  creatorLinks: 6,
  reviewNote: 500,
  claimMessage: 1000,
  /** Extra screenshots after the cover (so 5 images in all). */
  gallery: 4,
  /** Max sites in the home page's featured header. */
  featured: 12,
  /** Max screenshot size in bytes. */
  imageBytes: 5 * 1024 * 1024,
  /** Max preview-video size in bytes, as stored (after compression in the browser). */
  videoBytes: 15 * 1024 * 1024,
  /** Largest video file people can pick (it is compressed before upload). */
  videoInputBytes: 500 * 1024 * 1024,
  /** Max preview-video length in seconds. */
  videoSeconds: 60,
  /** Max listings one user can have waiting for review at once. */
  pendingPerUser: 5,
  /** Max URLs per admin import batch. */
  importBatch: 10,
} as const;
