import Link from "next/link";
import { CopyButton } from "@/components/guides/CopyButton";
import { GuideText } from "@/components/guides/GuideText";
import { GUIDE_AREAS, areaLabel, roleLabel } from "@/components/admin/guideLabels";
import { SECTIONS, pad } from "@/content/docs";
import { placeholders } from "@/lib/guideText";
import type { DocsGuide, DocsGuideSummary } from "@/lib/docsGuides";
import { DocsToc } from "./DocsToc";

// The team guides on the docs: written and edited in the admin (/guides),
// read here. Only guides marked ready show. Same frame as a docs page: the
// section number in orange, the title large, a strip of facts, then the
// sections with "On this page" beside them.

const SECTION_NUMBER = pad(SECTIONS.length + 1);

function dateOf(ms: number) {
  return new Intl.DateTimeFormat("en", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Tbilisi" }).format(ms);
}

/** /guides: every ready guide, by area. */
export function DocsGuidesHome({ guides }: { guides: DocsGuideSummary[] }) {
  const areas = GUIDE_AREAS.map((a) => ({ ...a, guides: guides.filter((g) => g.area === a.value) })).filter((a) => a.guides.length);
  return (
    <article className="docs-article">
      <header className="docs-head">
        <p className="docs-kicker">
          <span className="docs-num">{SECTION_NUMBER}</span>
          Team guides
        </p>
        <h1>
          Guides<span className="docs-dot">.</span>
        </h1>
        <p className="docs-lead">How-tos for daily work: what to send, where to click, step by step. Every message has a Copy button.</p>
        <dl className="docs-strip">
          <div>
            <dt>Guides</dt>
            <dd>{pad(guides.length)}</dd>
          </div>
          <div>
            <dt>Areas</dt>
            <dd>{pad(areas.length)}</dd>
          </div>
          <div>
            <dt>Access</dt>
            <dd>Admins only</dd>
          </div>
          <div>
            <dt>Source</dt>
            <dd>Admin › Guides</dd>
          </div>
        </dl>
      </header>
      {guides.length === 0 ? (
        <p className="docs-lead docs-guides-empty">No guides are ready yet.</p>
      ) : (
        <section className="docs-sections" aria-label="Guides by area">
          {areas.map((area, i) => (
            <div key={area.value} className="docs-section-cell">
              <p className="docs-section-num">{pad(i + 1)}</p>
              <h2>{area.label}</h2>
              <ul>
                {area.guides.map((g) => (
                  <li key={g.slug}>
                    <Link href={`/guides/${g.slug}`}>
                      <span>{g.title}</span>
                      <span className="docs-arrow" aria-hidden="true">
                        →
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      )}
    </article>
  );
}

/** /guides/<slug>: one guide, its sections as the page's headings. */
export function DocsGuideArticle({ guide, guides }: { guide: DocsGuide; guides: DocsGuideSummary[] }) {
  const at = guides.findIndex((g) => g.slug === guide.slug);
  const prev = at > 0 ? guides[at - 1] : null;
  const next = at >= 0 && at < guides.length - 1 ? guides[at + 1] : null;
  return (
    <article className="docs-article">
      <header className="docs-head">
        <p className="docs-kicker">
          <span className="docs-num">{SECTION_NUMBER}</span>
          <Link href="/guides">Team guides</Link>
          <span aria-hidden="true">/</span>
          {areaLabel(guide.area)}
        </p>
        <h1>
          {guide.title}
          <span className="docs-dot">.</span>
        </h1>
        {guide.summary && <p className="docs-lead">{guide.summary}</p>}
        <dl className="docs-strip">
          <div>
            <dt>Area</dt>
            <dd>{areaLabel(guide.area)}</dd>
          </div>
          <div>
            <dt>For</dt>
            <dd>{guide.roles.map(roleLabel).join(", ")}</dd>
          </div>
          <div>
            <dt>Updated</dt>
            <dd>{dateOf(guide.updatedAt)}</dd>
          </div>
          <div>
            <dt>Source</dt>
            <dd>Admin › Guides</dd>
          </div>
        </dl>
      </header>

      <div className="docs-body">
        <div className="docs-prose">
          {guide.sections.map((s, i) => {
            const id = `step-${i + 1}`;
            const blanks = s.kind === "template" ? placeholders(s.body) : [];
            return (
              <section key={s.id} className="docs-guide-section" aria-labelledby={id}>
                <h2 id={id}>
                  <a href={`#${id}`} className="docs-anchor" aria-hidden="true" tabIndex={-1}>
                    #
                  </a>
                  {s.heading}
                </h2>
                {s.kind === "template" ? (
                  <div className="docs-message">
                    <p className="docs-message-label">Message{s.language ? ` · ${s.language === "ka" ? "Georgian" : "English"}` : ""}</p>
                    <div className="docs-message-text">{s.body}</div>
                    {s.body && (
                      <div className="docs-message-foot">
                        <CopyButton text={s.body} className="docs-copy" />
                        {blanks.length > 0 && <span>Fill in: {blanks.map((b) => `{${b}}`).join(", ")}</span>}
                      </div>
                    )}
                  </div>
                ) : (
                  s.body && <GuideText text={s.body} />
                )}
                {s.images.length > 0 && (
                  <div className="docs-guide-images">
                    {s.images.map((img) =>
                      img.url ? (
                        <figure key={img.mediaId}>
                          <a href={img.url} target="_blank" rel="noopener noreferrer">
                            <img src={img.url} alt={img.caption ?? ""} loading="lazy" />
                          </a>
                          {img.caption && <figcaption>{img.caption}</figcaption>}
                        </figure>
                      ) : null,
                    )}
                  </div>
                )}
              </section>
            );
          })}
        </div>
        <DocsToc />
      </div>

      <nav className="docs-pager" aria-label="More guides">
        {prev ? (
          <Link href={`/guides/${prev.slug}`} className="docs-pager-link" data-dir="prev">
            <span>← Previous</span>
            <strong>{prev.title}</strong>
          </Link>
        ) : (
          <span />
        )}
        {next ? (
          <Link href={`/guides/${next.slug}`} className="docs-pager-link" data-dir="next">
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
