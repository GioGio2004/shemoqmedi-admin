"use client";

import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import { reducedMotion, springs } from "../liquid";

// The feed's motion and masonry. Cards carry data-flip="<id>". When the set of
// cards changes (a filter, a post leaving), the ones that stay glide from
// where they were (FLIP) and the new ones rise in, staggered; the first
// screen's cards rise in on the first draw too. From 640px the feed is a
// masonry grid: 4px rows, each card spanning its own height.

const ROW = 4;
const GAP = 22;

function cardsOf(el: HTMLElement) {
  return Array.from(el.children).filter((c): c is HTMLElement => c instanceof HTMLElement && !!c.dataset.flip);
}

function span(el: HTMLElement, masonry: boolean) {
  for (const c of cardsOf(el)) c.style.gridRowEnd = masonry ? `span ${Math.ceil((c.offsetHeight + GAP) / ROW)}` : "";
}

export function useFeedLayout(ref: RefObject<HTMLElement | null>, keys: string, masonry: boolean) {
  const prev = useRef(new Map<string, { x: number; y: number }>());
  const wasMasonry = useRef(masonry);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    span(el, masonry);
    const base = el.getBoundingClientRect();
    const next = new Map<string, { x: number; y: number }>();
    // A layout switch (phone to grid width) re-records the places without motion.
    const still = reducedMotion() || typeof el.animate !== "function" || wasMasonry.current !== masonry;
    wasMasonry.current = masonry;
    const e = springs();
    let k = 0;
    for (const c of cardsOf(el)) {
      const r = c.getBoundingClientRect();
      const pos = { x: r.left - base.left, y: r.top - base.top };
      const id = c.dataset.flip!;
      next.set(id, pos);
      if (still) continue;
      const old = prev.current.get(id);
      if (old) {
        const dx = old.x - pos.x;
        const dy = old.y - pos.y;
        if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) c.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }], { duration: e.snappy.d + 80, easing: e.snappy.e });
      } else if (r.top < window.innerHeight && k < 8) {
        c.animate([{ opacity: 0, transform: "translateY(22px) scale(.96)" }, { opacity: 1, transform: "none" }], { duration: e.gentle.d + 160, easing: e.gentle.e, delay: 40 + k * 55, fill: "backwards" });
        k++;
      }
    }
    prev.current = next;
  }, [ref, keys, masonry]);

  // Heights change later (a picture's shape becomes known, an action row changes): keep the spans right.
  useEffect(() => {
    const el = ref.current;
    if (!el || !masonry || typeof ResizeObserver === "undefined") return;
    let raf = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => span(el, true));
    });
    for (const c of cardsOf(el)) ro.observe(c);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [ref, keys, masonry]);
}
