import Link from "next/link";
import type { ReactNode } from "react";
import { PAGES, pad, type DocPage } from "@/content/docs";
import { DocsToc } from "./DocsToc";

type Page = (typeof PAGES)[number];

// One docs page: the section number in orange, the title large, the one-line
// summary, a strip of facts, then the text with "On this page" beside it,
// and the previous and next pages at the bottom.

export function DocArticle({ page, prev, next, children }: { page: Page; prev: DocPage | null; next: DocPage | null; children: ReactNode }) {
  const inSection = page.section.pages.findIndex((p) => p.slug === page.slug) + 1;
  return (
    <article className="docs-article">
      <header className="docs-head">
        <p className="docs-kicker">
          <span className="docs-num">{pad(page.sectionIndex + 1)}</span>
          {page.section.title}
        </p>
        <h1>
          {page.title}
          <span className="docs-dot">.</span>
        </h1>
        <p className="docs-lead">{page.summary}</p>
        <dl className="docs-strip">
          <div>
            <dt>Section</dt>
            <dd>{page.section.title}</dd>
          </div>
          <div>
            <dt>Page</dt>
            <dd>
              {pad(inSection)} of {pad(page.section.pages.length)}
            </dd>
          </div>
          <div>
            <dt>Access</dt>
            <dd>Admins only</dd>
          </div>
          <div>
            <dt>Source</dt>
            <dd>
              <code>content/docs/{page.slug}.mdx</code>
            </dd>
          </div>
        </dl>
      </header>

      <div className="docs-body">
        <div className="docs-prose">{children}</div>
        <DocsToc />
      </div>

      <nav className="docs-pager" aria-label="More pages">
        {prev ? (
          <Link href={`/${prev.slug}`} className="docs-pager-link" data-dir="prev">
            <span>← Previous</span>
            <strong>{prev.title}</strong>
          </Link>
        ) : (
          <span />
        )}
        {next ? (
          <Link href={`/${next.slug}`} className="docs-pager-link" data-dir="next">
            <span>Next →</span>
            <strong>{next.title}</strong>
          </Link>
        ) : (
          <span />
        )}
      </nav>
    </article>
  );
}
