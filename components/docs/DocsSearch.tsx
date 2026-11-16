"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import type { DocsIndex } from "@/content/docs";

// The search sheet: matches page titles, keywords, summaries and section
// names. Arrow keys move, Enter opens, Escape closes.

type Hit = { slug: string; title: string; summary: string; keywords: string[]; section: string; number: string };

function score(hit: Hit, words: string[]) {
  let total = 0;
  const title = hit.title.toLowerCase();
  for (const w of words) {
    if (title.startsWith(w)) total += 8;
    else if (title.includes(w)) total += 5;
    else if (hit.keywords.some((k) => k.toLowerCase().includes(w))) total += 3;
    else if (hit.summary.toLowerCase().includes(w) || hit.section.toLowerCase().includes(w)) total += 1;
    else return 0;
  }
  return total;
}

export function DocsSearch({ index, open, onClose, onNavigate }: { index: DocsIndex; open: boolean; onClose: () => void; onNavigate: () => void }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);

  const all: Hit[] = useMemo(
    () => index.flatMap((s) => s.pages.map((p) => ({ ...p, section: s.title, number: s.number }))),
    [index],
  );
  const hits = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return all;
    return all
      .map((h) => ({ h, s: score(h, words) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .map((x) => x.h);
  }, [all, query]);

  // Focus the field when the sheet opens (it is cleared when it closes).
  useEffect(() => {
    if (!open) return;
    const id = requestAnimationFrame(() => input.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [open]);

  function close() {
    onClose();
    setQuery("");
    setActive(0);
  }

  function go(slug: string) {
    close();
    onNavigate();
    router.push(`/${slug}`);
  }

  function onKey(e: React.KeyboardEvent) {
    if (e.key === "Escape") close();
    else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, hits.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter" && hits[active]) go(hits[active].slug);
  }

  return (
    <div className="docs-search" data-open={open || undefined} aria-hidden={!open} onClick={close}>
      <div className="docs-search-panel" role="dialog" aria-modal="true" aria-label="Search the docs" onClick={(e) => e.stopPropagation()} onKeyDown={onKey}>
        <div className="docs-search-field">
          <input
            ref={input}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            placeholder="Search the docs"
            aria-label="Search the docs"
            tabIndex={open ? 0 : -1}
          />
          <button type="button" onClick={close} tabIndex={open ? 0 : -1}>
            Esc
          </button>
        </div>
        <ul className="docs-search-hits" role="listbox" aria-label="Pages">
          {hits.map((hit, i) => (
            <li key={hit.slug} role="option" aria-selected={i === active}>
              <button type="button" data-active={i === active || undefined} onMouseEnter={() => setActive(i)} onClick={() => go(hit.slug)} tabIndex={-1}>
                <span className="docs-hit-num">{hit.number}</span>
                <span className="docs-hit-text">
                  <strong>{hit.title}</strong>
                  <span>{hit.summary}</span>
                </span>
                <span className="docs-hit-section">{hit.section}</span>
              </button>
            </li>
          ))}
          {hits.length === 0 ? <li className="docs-search-empty">Nothing matches &ldquo;{query}&rdquo;.</li> : null}
        </ul>
      </div>
    </div>
  );
}
