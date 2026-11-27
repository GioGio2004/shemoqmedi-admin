import Link from "next/link";
import { PAGES, SECTIONS, pad } from "@/content/docs";

// The docs home: "Docs." large beside the crow on an orange block (the
// portfolio's silhouette block), a strip of facts, then every section as a
// cell of the grid with its pages.

export function DocsHome({ guides = [] }: { guides?: { slug: string; title: string }[] }) {
  return (
    <div className="docs-home">
      <section className="docs-hero">
        <div className="docs-hero-text">
          <p className="docs-kicker">
            <span className="docs-num">00</span>
            Shemoqmedi, from the inside
          </p>
          <h1>
            Docs<span className="docs-dot">.</span>
          </h1>
          <p className="docs-lead">Every feature, job and tool behind shemoqmedi.space, explained for the people who run it.</p>
        </div>
        <div className="docs-hero-block" aria-hidden="true">
          <span className="docs-mark docs-mark-big" />
        </div>
      </section>

      <dl className="docs-strip docs-strip-home">
        <div>
          <dt>Sections</dt>
          <dd>{pad(SECTIONS.length)}</dd>
        </div>
        <div>
          <dt>Pages</dt>
          <dd>{pad(PAGES.length)}</dd>
        </div>
        <div>
          <dt>Access</dt>
          <dd>Admins only</dd>
        </div>
        <div>
          <dt>Start with</dt>
          <dd>
            <Link href="/onboarding">Your first week →</Link>
          </dd>
        </div>
      </dl>

      <section className="docs-sections" aria-label="Sections">
        {SECTIONS.map((section, i) => (
          <div key={section.id} className="docs-section-cell">
            <p className="docs-section-num">{pad(i + 1)}</p>
            <h2>{section.title}</h2>
            <p className="docs-section-blurb">{section.blurb}</p>
            <ul>
              {section.pages.map((page) => (
                <li key={page.slug}>
                  <Link href={`/${page.slug}`}>
                    <span>{page.title}</span>
                    <span className="docs-arrow" aria-hidden="true">
                      →
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
        <div className="docs-section-cell">
          <p className="docs-section-num">{pad(SECTIONS.length + 1)}</p>
          <h2>Team</h2>
          <p className="docs-section-blurb">Your tasks, and the how-tos for daily work: what to send, where to click.</p>
          <ul>
            <li>
              <Link href="/tasks">
                <span>Tasks</span>
                <span className="docs-arrow" aria-hidden="true">
                  →
                </span>
              </Link>
            </li>
            {guides.map((g) => (
              <li key={g.slug}>
                <Link href={`/guides/${g.slug}`}>
                  <span>{g.title}</span>
                  <span className="docs-arrow" aria-hidden="true">
                    →
                  </span>
                </Link>
              </li>
            ))}
            <li>
              <Link href="/guides">
                <span>All guides</span>
                <span className="docs-arrow" aria-hidden="true">
                  →
                </span>
              </Link>
            </li>
          </ul>
        </div>
      </section>
    </div>
  );
}
