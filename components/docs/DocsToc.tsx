"use client";

import { useEffect, useState } from "react";

// "On this page": the page's ## and ### headings, read from the article once
// it is on screen, with the one being read marked.

type Item = { id: string; text: string; level: 2 | 3 };

export function DocsToc() {
  const [items, setItems] = useState<Item[]>([]);
  const [current, setCurrent] = useState<string | null>(null);

  useEffect(() => {
    const headings = Array.from(document.querySelectorAll<HTMLHeadingElement>(".docs-prose h2[id], .docs-prose h3[id]"));
    // Read once the article is painted (and outside the effect's own pass).
    const frame = requestAnimationFrame(() =>
      setItems(
        headings.map((h) => ({
          id: h.id,
          text: (h.textContent ?? "").replace(/^#/, "").trim(),
          level: h.tagName === "H2" ? 2 : 3,
        })),
      ),
    );
    if (!headings.length) return () => cancelAnimationFrame(frame);
    const observer = new IntersectionObserver(
      (entries) => {
        const seen = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (seen[0]) setCurrent(seen[0].target.id);
      },
      { rootMargin: "-80px 0px -70% 0px" },
    );
    headings.forEach((h) => observer.observe(h));
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, []);

  if (!items.length) return <aside className="docs-toc" />;
  return (
    <aside className="docs-toc" aria-label="On this page">
      <p className="docs-toc-label">On this page</p>
      <ul>
        {items.map((item) => (
          <li key={item.id} data-level={item.level}>
            <a href={`#${item.id}`} aria-current={current === item.id ? "location" : undefined}>
              {item.text}
            </a>
          </li>
        ))}
      </ul>
    </aside>
  );
}
