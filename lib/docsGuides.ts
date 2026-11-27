import "server-only";
import { cache } from "react";
import { api } from "@/convex/_generated/api";
import { GUIDE_AREAS } from "@/components/admin/guideLabels";
import { getDocsConvex, getDocsViewer } from "./docsAccess";

// The team guides (convex/guides.ts) as the docs show them: only guides
// marked "ready" (drafts stay in the admin until the owner publishes them),
// read with the viewer's own session, so Convex checks the role again.

/** Ready guides, for the sidebar, search and the Team guides page. Empty without access. */
export const getDocsGuides = cache(async () => {
  const viewer = await getDocsViewer();
  const client = await getDocsConvex();
  if (viewer.status !== "ok" || !client) return [];
  const all = await client.query(api.guides.list, {}).catch(() => []);
  const order = (area: string) => GUIDE_AREAS.findIndex((a) => a.value === area);
  return all
    .filter((g) => g.status === "ready")
    .sort((a, b) => order(a.area) - order(b.area) || a.title.localeCompare(b.title));
});

/** One ready guide with its sections, or null. */
export const getDocsGuide = cache(async (slug: string) => {
  const viewer = await getDocsViewer();
  const client = await getDocsConvex();
  if (viewer.status !== "ok" || !client) return null;
  const guide = await client.query(api.guides.get, { slug }).catch(() => null);
  return guide && guide.status === "ready" ? guide : null;
});

export type DocsGuideSummary = Awaited<ReturnType<typeof getDocsGuides>>[number];
export type DocsGuide = NonNullable<Awaited<ReturnType<typeof getDocsGuide>>>;
