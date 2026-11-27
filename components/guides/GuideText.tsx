import { Fragment } from "react";
import { linkify, parseGuideText } from "@/lib/guideText";

// A guide section's text (lib/guideText.ts) as paragraphs, bullets and
// numbered steps. Plain elements, so the admin (.guide-text) and the docs
// (.docs-prose) style it each their own way. Works on the server and client.

function Inline({ text }: { text: string }) {
  return (
    <>
      {linkify(text).map((p, i) =>
        p.type === "link" ? (
          <a key={i} href={p.href} target="_blank" rel="noopener noreferrer">
            {p.text}
          </a>
        ) : (
          <Fragment key={i}>{p.text}</Fragment>
        ),
      )}
    </>
  );
}

export function GuideText({ text, className }: { text: string; className?: string }) {
  return (
    <div className={className}>
      {parseGuideText(text).map((b, i) =>
        b.type === "paragraph" ? (
          <p key={i} className="guide-lines">
            <Inline text={b.lines.join("\n")} />
          </p>
        ) : b.type === "bullets" ? (
          <ul key={i}>
            {b.items.map((item, j) => (
              <li key={j} className="guide-lines">
                <Inline text={item} />
              </li>
            ))}
          </ul>
        ) : (
          <ol key={i} start={b.start}>
            {b.items.map((item, j) => (
              <li key={j} className="guide-lines">
                <Inline text={item} />
              </li>
            ))}
          </ol>
        ),
      )}
    </div>
  );
}
