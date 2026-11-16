import type { MDXComponents } from "mdx/types";
import { Children, isValidElement, type ReactNode } from "react";

// How Markdown in content/docs renders: headings get ids (the "On this page"
// list and links to a section), external links open in a new tab, tables
// scroll sideways on phones, and one component of our own: <Callout>.

function text(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(text).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return text(node.props.children);
  return "";
}

export function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[`'"’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function heading(Tag: "h2" | "h3") {
  return function Heading({ children }: { children?: ReactNode }) {
    const id = slugify(text(children));
    return (
      <Tag id={id}>
        <a href={`#${id}`} className="docs-anchor" aria-hidden="true" tabIndex={-1}>
          #
        </a>
        {children}
      </Tag>
    );
  };
}

const KIND_LABEL = { note: "Note", warning: "Careful", sensitive: "Internal only" } as const;

export function Callout({ kind = "note", title, children }: { kind?: keyof typeof KIND_LABEL; title?: string; children?: ReactNode }) {
  return (
    <aside className="docs-callout" data-kind={kind}>
      <p className="docs-callout-label">{title ?? KIND_LABEL[kind]}</p>
      <div className="docs-callout-body">{Children.toArray(children)}</div>
    </aside>
  );
}

export const docsMdxComponents: MDXComponents = {
  h2: heading("h2"),
  h3: heading("h3"),
  a: ({ href = "", children }) => {
    const external = /^https?:\/\//.test(href);
    return (
      <a href={href} {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
        {children}
        {external ? <span className="docs-ext" aria-hidden="true">↗</span> : null}
      </a>
    );
  },
  table: ({ children }) => (
    <div className="docs-table">
      <table>{children}</table>
    </div>
  ),
  Callout,
};
