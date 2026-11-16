import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DocArticle } from "@/components/docs/DocArticle";
import { DocsHome } from "@/components/docs/DocsHome";
import { findPage } from "@/content/docs";
import { getDocsViewer } from "@/lib/docsAccess";

// Every docs page: / is the home, /<slug> a page from content/docs. The
// access check runs here too, not only in the layout: Next renders layouts
// and pages side by side, so a page must never rely on its layout to keep
// its text from someone without access.

type Props = { params: Promise<{ slug?: string[] }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const viewer = await getDocsViewer();
  if (viewer.status !== "ok") return {};
  const { slug } = await params;
  const found = slug?.length === 1 ? findPage(slug[0]) : null;
  return found ? { title: found.page.title } : {};
}

export default async function DocPage({ params }: Props) {
  const viewer = await getDocsViewer();
  if (viewer.status !== "ok") return null;

  const { slug } = await params;
  if (!slug || slug.length === 0) return <DocsHome />;
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
