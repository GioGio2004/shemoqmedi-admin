// The table of contents of the team docs (docs.shemoqmedi.space). Each page is
// an MDX file in this folder; add a page by writing the file and listing it
// here. The order here is the order of the sidebar, the home page and the
// previous/next links. See content/docs/contributing.mdx.

import type { ComponentType } from "react";

export type DocPage = {
  slug: string;
  title: string;
  /** One sentence: under the title, on the home page and in search. */
  summary: string;
  /** Extra words search should match. */
  keywords: string[];
  load: () => Promise<{ default: ComponentType }>;
};

export type DocSection = { id: string; title: string; blurb: string; pages: DocPage[] };

export const SECTIONS: DocSection[] = [
  {
    id: "start",
    title: "Start here",
    blurb: "What Shemoqmedi is, what it runs on, and how to find your way around.",
    pages: [
      { slug: "overview", title: "Overview", summary: "What Shemoqmedi is, who uses it, and how the pieces fit together.", keywords: ["architecture", "hosts", "repos", "glossary"], load: () => import("./overview.mdx") },
      { slug: "stack", title: "Stack and services", summary: "Every service the platform runs on, and the environment variables that connect them.", keywords: ["vercel", "convex", "clerk", "imagekit", "r2", "resend", "env"], load: () => import("./stack.mdx") },
      { slug: "onboarding", title: "Your first week", summary: "A reading order for new team members, and the rules that keep production safe.", keywords: ["new hire", "start", "rules", "week"], load: () => import("./onboarding.mdx") },
      { slug: "contributing", title: "Writing these docs", summary: "How to add or change a page, and what must never go in one.", keywords: ["mdx", "edit", "add page", "secrets"], load: () => import("./contributing.mdx") },
    ],
  },
  {
    id: "product",
    title: "Product",
    blurb: "The public site and the things it is made of: listings, creators, awards and the jury.",
    pages: [
      { slug: "storefront", title: "Public site", summary: "Every page of shemoqmedi.space, how it is rendered and where to change it.", keywords: ["storefront", "routes", "isr", "pages", "crow"], load: () => import("./storefront.mdx") },
      { slug: "listings", title: "Listings", summary: "A listed website from creation to the public page.", keywords: ["sites", "status", "screenshots", "claims"], load: () => import("./listings.mdx") },
      { slug: "creators", title: "Creators", summary: "People and studios credited on listings, and what is public about them.", keywords: ["studios", "profiles", "contact", "socials"], load: () => import("./creators.mdx") },
      { slug: "awards", title: "Awards", summary: "How sites earn Honorable Mentions, Site of the Day, Month and Year.", keywords: ["sotd", "sotm", "soty", "hm", "score", "badges", "audit"], load: () => import("./awards.mdx") },
      { slug: "jury", title: "Jury", summary: "Who scores sites, how they are invited, and what they see.", keywords: ["jurors", "evaluate", "invite", "votes"], load: () => import("./jury.mdx") },
      { slug: "seo", title: "SEO", summary: "How the site is found, the rules for links, and where we stand.", keywords: ["search", "google", "sitemap", "links", "indexing"], load: () => import("./seo.mdx") },
    ],
  },
  {
    id: "tools",
    title: "Admin and Studio",
    blurb: "The tools the team works in every day.",
    pages: [
      { slug: "admin", title: "Admin", summary: "The admin app page by page, and how roles work.", keywords: ["dashboard", "review", "roles", "setRole"], load: () => import("./admin.mdx") },
      { slug: "studio", title: "Studio", summary: "Where posts, graphics and reels are made and published.", keywords: ["queue", "graphics", "reels", "publish", "push"], load: () => import("./studio.mdx") },
      { slug: "media", title: "Media pipeline", summary: "How screenshots and videos get from a laptop to the site.", keywords: ["imagekit", "r2", "webp", "video", "upload"], load: () => import("./media.mdx") },
    ],
  },
  {
    id: "automations",
    title: "Automations",
    blurb: "What runs on its own: scheduled jobs, emails and social posts.",
    pages: [
      { slug: "automations", title: "Jobs and webhooks", summary: "Every scheduled job and webhook, and how to run or pause one.", keywords: ["cron", "schedule", "webhook", "tick", "digest"], load: () => import("./automations.mdx") },
      { slug: "email", title: "Email", summary: "Every email the platform sends, and the rules for sending.", keywords: ["resend", "unsubscribe", "broadcast", "digest"], load: () => import("./email.mdx") },
      { slug: "social", title: "Social desk", summary: "How social posts are queued, approved and published.", keywords: ["facebook", "instagram", "posts", "queue", "meta"], load: () => import("./social.mdx") },
    ],
  },
  {
    id: "ai",
    title: "AI and MCP",
    blurb: "The connector that lets an AI assistant work the desk, tool by tool.",
    pages: [
      { slug: "mcp", title: "MCP connector", summary: "Every tool the AI connector has, and which ones publish or send.", keywords: ["mcp", "claude", "tools", "agent", "connector"], load: () => import("./mcp.mdx") },
    ],
  },
  {
    id: "ops",
    title: "Operations",
    blurb: "Shipping, fixing and keeping it safe.",
    pages: [
      { slug: "deploy", title: "Shipping code", summary: "From a change on your laptop to production, and back if needed.", keywords: ["deploy", "vercel", "convex deploy", "rollback", "tests"], load: () => import("./deploy.mdx") },
      { slug: "runbooks", title: "Runbooks", summary: "Step-by-step fixes for the things that go wrong.", keywords: ["incident", "down", "failed", "fix", "rotate"], load: () => import("./runbooks.mdx") },
      { slug: "security", title: "Security", summary: "Who can do what, where secrets live, and what to watch.", keywords: ["auth", "roles", "secrets", "webhooks", "privacy"], load: () => import("./security.mdx") },
    ],
  },
];

export const PAGES: (DocPage & { section: DocSection; sectionIndex: number })[] = SECTIONS.flatMap((section, sectionIndex) =>
  section.pages.map((page) => ({ ...page, section, sectionIndex })),
);

export function findPage(slug: string) {
  const index = PAGES.findIndex((p) => p.slug === slug);
  if (index === -1) return null;
  return { page: PAGES[index], prev: PAGES[index - 1] ?? null, next: PAGES[index + 1] ?? null };
}

/** "01", "02", ... */
export function pad(n: number) {
  return String(n).padStart(2, "0");
}

/** What the client needs for search and the sidebar (no loaders). */
export function docsIndex() {
  return SECTIONS.map((s, i) => ({
    id: s.id,
    number: pad(i + 1),
    title: s.title,
    pages: s.pages.map(({ slug, title, summary, keywords }) => ({ slug, title, summary, keywords })),
  }));
}
export type DocsIndex = ReturnType<typeof docsIndex>;

/** The sidebar and search entry for the team guides (edited in the admin, read here): "All guides", then each ready guide. */
export function guidesIndexSection(guides: { slug: string; title: string; summary?: string; area: string; roles: string[] }[]) {
  return {
    id: "guides",
    number: pad(SECTIONS.length + 1),
    title: "Team guides",
    pages: [
      { slug: "guides", title: "All guides", summary: "How-tos for daily work: what to send, where to click.", keywords: ["guides", "how to", "templates", "messages"] },
      ...guides.map((g) => ({
        slug: `guides/${g.slug}`,
        title: g.title,
        summary: g.summary ?? "",
        keywords: ["guide", g.area, ...g.roles],
      })),
    ],
  };
}
