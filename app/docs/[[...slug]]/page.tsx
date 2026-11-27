import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DocArticle } from "@/components/docs/DocArticle";
import { DocsHome } from "@/components/docs/DocsHome";
import { DocsGuideArticle, DocsGuidesHome } from "@/components/docs/DocsGuides";
import { DocsTask, DocsTasks } from "@/components/docs/DocsTasks";
import { findPage } from "@/content/docs";
import { getDocsViewer } from "@/lib/docsAccess";
import { getDocsGuide, getDocsGuides } from "@/lib/docsGuides";

// Every docs page: / is the home, /<slug> a page from content/docs, and
// /guides, /guides/<slug> the team guides (written in the admin, read here),
// and /tasks, /tasks/<number> the team's task board.
// The access check runs here too, not only in the layout: Next renders
// layouts and pages side by side, so a page must never rely on its layout to
// keep its text from someone without access.

type Props = { params: Promise<{ slug?: string[] }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const viewer = await getDocsViewer();
  if (viewer.status !== "ok") return {};
  const { slug } = await params;
  if (slug?.[0] === "tasks") return { title: slug.length === 2 ? `SHQ-${slug[1]}` : "Tasks" };
  if (slug?.[0] === "guides") {
    if (slug.length === 1) return { title: "Team guides" };
    const guide = slug.length === 2 ? await getDocsGuide(slug[1]) : null;
    return guide ? { title: guide.title } : {};
  }
  const found = slug?.length === 1 ? findPage(slug[0]) : null;
  return found ? { title: found.page.title } : {};
}

export default async function DocPage({ params }: Props) {
  const viewer = await getDocsViewer();
  if (viewer.status !== "ok") return null;

  const { slug } = await params;
  if (!slug || slug.length === 0) return <DocsHome guides={await getDocsGuides()} />;
  // Tasks: the board and each task, live from Convex in the browser (components/tasks).
  if (slug[0] === "tasks") {
    if (slug.length === 1) return <DocsTasks />;
    if (slug.length === 2 && /^\d{1,6}$/.test(slug[1])) return <DocsTask number={Number(slug[1])} />;
    notFound();
  }
  if (slug[0] === "guides") {
    const guides = await getDocsGuides();
    if (slug.length === 1) return <DocsGuidesHome guides={guides} />;
    const guide = slug.length === 2 ? await getDocsGuide(slug[1]) : null;
    if (!guide) notFound();
    return <DocsGuideArticle guide={guide} guides={guides} />;
  }
  if (slug.length > 1) notFound();
  const found = findPage(slug[0]);
  if (!found) notFound();

  const { default: Content } = await found.page.load();
  return (
    <DocArticle page={found.page} prev={found.prev} next={found.next}>
      <Content />
    </DocArticle>
  );
}
