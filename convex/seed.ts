// Flagship launch listings, loaded from the admin "Import" page (or
// `npx convex run importer:seedFlagship` while signed in as an admin).
//
// Policy: Giorgi Khvichia's own projects are Shemoqmedi team sites: shown
// as such and never eligible for awards (byTeam). Third-party sites enter as
// unawarded, unclaimed nominees in the live voting window, so their results
// come from the real jury. Their owners can claim the listing or ask for removal.

export const FLAGSHIP = [
  {
    url: "https://room.kenchogroup.ge",
    title: "Room Planner by Kencho Group",
    category: "architecture",
    technologies: ["Next.js", "TypeScript", "Tailwind", "AI"],
    region: "georgia",
    creatorTier: "solo",
    creditName: "Giorgi Khvichia",
    location: "Tbilisi, GE",
    status: "awarded",
    publishedDaysAgo: 12,
    editorialScore: 8.9,
    isClaimed: true,
    byTeam: true,
  },
  {
    url: "https://kalami.space",
    title: "Kalami Code Sandbox",
    category: "saas",
    technologies: ["Next.js", "TypeScript", "MCP"],
    region: "georgia",
    creatorTier: "solo",
    creditName: "Giorgi Khvichia",
    location: "Tbilisi, GE",
    status: "awarded",
    publishedDaysAgo: 9,
    editorialScore: 8.7,
    isClaimed: true,
    byTeam: true,
  },
  {
    url: "https://kenchogroup.ge",
    title: "Kencho Group",
    category: "architecture",
    technologies: ["Next.js", "Tailwind", "Convex"],
    region: "georgia",
    creatorTier: "solo",
    creditName: "Giorgi Khvichia",
    location: "Tbilisi, GE",
    status: "in_voting",
    votingDaysLeft: 5,
    editorialScore: 8.65,
    isClaimed: true,
    byTeam: true,
  },
  // Third-party nominees: no scores, no awards, unclaimed.
  {
    url: "https://linear.app",
    title: "Linear",
    category: "saas",
    technologies: ["Next.js", "WebGL", "Tailwind"],
    region: "global",
    creatorTier: "agency",
    creditName: "Linear Design Team",
    status: "in_voting",
    votingDaysLeft: 6.5,
    isClaimed: false,
  },
  {
    url: "https://floema.pt",
    title: "Floema",
    category: "architecture",
    technologies: ["WebGL", "Three.js", "GSAP"],
    region: "global",
    creatorTier: "agency",
    creditName: "Bürocratik",
    status: "in_voting",
    votingDaysLeft: 6,
    isClaimed: false,
  },
  {
    url: "https://crosty.ge",
    title: "Crosty Shoes",
    category: "e-commerce",
    technologies: [],
    region: "georgia",
    creatorTier: "agency",
    creditName: "Crosty Studio",
    status: "in_voting",
    votingDaysLeft: 6,
    isClaimed: false,
  },
  {
    url: "https://holymotors.com",
    title: "Holy Motors",
    category: "portfolio",
    technologies: ["WebGL", "Motion"],
    region: "georgia",
    creatorTier: "agency",
    creditName: "Holy Motors",
    status: "in_voting",
    votingDaysLeft: 4.5,
    isClaimed: false,
  },
  {
    url: "https://postred.com",
    title: "POSTRED",
    category: "portfolio",
    technologies: ["WebGL", "GSAP", "Custom Audio"],
    region: "georgia",
    creatorTier: "agency",
    creditName: "Holy Motors",
    status: "in_voting",
    votingDaysLeft: 3.5,
    isClaimed: false,
  },
  {
    url: "https://stambahotel.com",
    title: "Stamba Hotel",
    category: "hospitality",
    technologies: ["Custom CMS"],
    region: "georgia",
    creatorTier: "agency",
    creditName: "Adjara Group Digital",
    status: "in_voting",
    votingDaysLeft: 2.5,
    isClaimed: false,
  },
] as const satisfies ReadonlyArray<{
  url: string;
  title: string;
  category: string;
  technologies: readonly string[];
  region: "georgia" | "global";
  creatorTier: "solo" | "agency";
  creditName: string;
  location?: string;
  status: "pending" | "in_voting" | "awarded";
  votingDaysLeft?: number;
  publishedDaysAgo?: number;
  editorialScore?: number;
  awards?: readonly ("SOTD" | "BSC" | "HM")[];
  isClaimed: boolean;
  /** Built by the Shemoqmedi team: never eligible for awards. */
  byTeam?: boolean;
}>;
