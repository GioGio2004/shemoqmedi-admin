import type { Metadata, Viewport } from "next";
import { connection } from "next/server";
import { DocsShell } from "@/components/docs/DocsShell";
import { NoAccess } from "@/components/docs/NoAccess";
import { docsIndex, guidesIndexSection } from "@/content/docs";
import { getDocsViewer } from "@/lib/docsAccess";
import { getDocsGuides } from "@/lib/docsGuides";
import "./docs.css";

// The team docs (docs.shemoqmedi.space): proxy.ts rewrites /x on the docs
// host to /docs/x, and this tree serves it. Rendered per request, never
// prerendered or cached, and only for admins (lib/docsAccess): anyone else
// gets the "no access" page and none of the docs' text.

export const metadata: Metadata = {
  title: { default: "Docs | Shemoqmedi", template: "%s | Shemoqmedi Docs" },
  description: "How Shemoqmedi works, for the team.",
  robots: { index: false, follow: false, nocache: true },
};

export const viewport: Viewport = { themeColor: "#1c1c1c" };

export default async function DocsLayout({ children }: { children: React.ReactNode }) {
  await connection();
  const viewer = await getDocsViewer();
  // The team guides live in Convex (edited in the admin); ready ones join the sidebar and search.
  const guides = viewer.status === "ok" ? await getDocsGuides() : [];
  return (
    <div className="docs">
      {viewer.status === "ok" ? (
        <DocsShell index={[...docsIndex(), guidesIndexSection(guides)]} viewerName={viewer.name}>
          {children}
        </DocsShell>
      ) : (
        <NoAccess signedOut={viewer.status === "signed-out"} />
      )}
    </div>
  );
}
