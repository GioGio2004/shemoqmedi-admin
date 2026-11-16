import Link from "next/link";

export default function DocsNotFound() {
  return (
    <section className="docs-missing">
      <p className="docs-kicker">
        <span className="docs-num">404</span>
        Not in the docs
      </p>
      <h1>
        No page here<span className="docs-dot">.</span>
      </h1>
      <p className="docs-lead">It may have moved. Search with ⌘K, or start from the contents.</p>
      <Link href="/" className="docs-button">
        All sections →
      </Link>
    </section>
  );
}
