"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import type { DocsIndex } from "@/content/docs";
import { ADMIN_APP_ORIGIN, STUDIO_ORIGIN } from "@/lib/hosts";
import { DocsSearch } from "./DocsSearch";

// The frame of every docs page: the mark and name top left, the corner tab
// top right (Search on a wide screen, Menu on a phone), the section list on
// the left, and the page. Paths are the docs host's own (/awards), which
// proxy.ts rewrites to app/docs/awards.

export function DocsShell({ index, viewerName, children }: { index: DocsIndex; viewerName: string | null; children: ReactNode }) {
  const pathname = usePathname();
  const slug = pathname.replace(/^\/(docs\/?)?/, "").split("/")[0] ?? "";
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  // Cmd+K / Ctrl+K, or "/" outside a text field, opens search.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const typing = e.target instanceof HTMLElement && e.target.closest("input, textarea, [contenteditable]");
      if ((e.key === "k" && (e.metaKey || e.ctrlKey)) || (e.key === "/" && !typing)) {
        e.preventDefault();
        setSearchOpen(true);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Nothing behind the phone menu or search scrolls.
  useEffect(() => {
    document.documentElement.toggleAttribute("data-docs-locked", menuOpen || searchOpen);
    return () => document.documentElement.removeAttribute("data-docs-locked");
  }, [menuOpen, searchOpen]);

  return (
    <div className="docs-shell">
      <header className="docs-top">
        <Link href="/" className="docs-brand" aria-label="Docs home">
          <span className="docs-mark" aria-hidden="true" />
          <span className="docs-brand-name">Shemoqmedi</span>
          <span className="docs-brand-sub">Docs</span>
        </Link>
      </header>

      <div className="docs-tab" data-open={menuOpen || undefined}>
        <button type="button" className="docs-tab-search" onClick={() => setSearchOpen(true)}>
          <span>Search</span>
          <kbd>⌘K</kbd>
        </button>
        <button type="button" className="docs-tab-menu" aria-expanded={menuOpen} aria-controls="docs-nav" onClick={() => setMenuOpen((o) => !o)}>
          <span className="docs-tab-words" data-open={menuOpen || undefined}>
            <span>Menu</span>
            <span>Close</span>
          </span>
        </button>
      </div>

      <nav id="docs-nav" className="docs-nav" data-open={menuOpen || undefined} aria-label="Docs">
        <button type="button" className="docs-nav-search" onClick={() => setSearchOpen(true)}>
          Search the docs
          <kbd>⌘K</kbd>
        </button>
        {index.map((section) => (
          <div key={section.id} className="docs-nav-section">
            <p className="docs-nav-label">
              <span>{section.number}</span>
              {section.title}
            </p>
            <ul>
              {section.pages.map((page) => (
                <li key={page.slug}>
                  <Link href={`/${page.slug}`} aria-current={slug === page.slug ? "page" : undefined} onClick={() => setMenuOpen(false)}>
                    {page.title}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
        <div className="docs-nav-foot">
          {viewerName ? <p>Signed in as {viewerName}</p> : null}
          <div>
            <a href={ADMIN_APP_ORIGIN}>Admin ↗</a>
            <a href={STUDIO_ORIGIN}>Studio ↗</a>
            <a href="https://www.shemoqmedi.space">Site ↗</a>
          </div>
        </div>
      </nav>

      <main className="docs-main">{children}</main>

      <DocsSearch
        index={index}
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        onNavigate={() => setMenuOpen(false)}
      />
    </div>
  );
}
