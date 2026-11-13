"use client";

import { useLayoutEffect, useRef, type RefObject } from "react";
import { Spring, animateSprings, clamp, reducedMotion, type SpringOwner } from "./liquid";

// The liquid selection indicator: two edge springs, the leading one quick and
// the trailing one lazy, so the droplet stretches in the direction it travels
// and squeezes back when it lands. Used by the tab bar and <Segmented>.

export type DropAxis = "x" | "y";

/** The imperative droplet: moves one element over a [start, start + size] span. */
export class DropletSpring implements SpringOwner {
  raf = 0;
  private a = new Spring();
  private b = new Spring();
  private size = 1;
  ready = false;
  constructor(
    private el: HTMLElement,
    public axis: DropAxis = "x",
  ) {}

  setAxis(axis: DropAxis) {
    if (axis === this.axis) return;
    this.axis = axis;
    this.el.style.width = "";
    this.el.style.height = "";
    this.ready = false;
  }

  to(start: number, size: number, instant = false) {
    if (!size) return;
    const end = start + size;
    this.el.style[this.axis === "x" ? "width" : "height"] = `${size}px`;
    this.size = size;
    const reduce = reducedMotion();
    if (instant || reduce || !this.ready) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
      const wasReady = this.ready;
      this.a.set(start);
      this.b.set(end);
      this.ready = true;
      this.el.dataset.ready = "";
      this.render();
      if (!instant && reduce && wasReady && this.el.animate) this.el.animate([{ opacity: 0.4 }, { opacity: 1 }], { duration: 180 });
      return;
    }
    const forward = start > this.a.t;
    const lead = forward ? this.b : this.a;
    const trail = forward ? this.a : this.b;
    lead.k = 560;
    lead.c = 30; // leading edge: quick, a little overshoot
    trail.k = 210;
    trail.c = 24; // trailing edge: lags, so the droplet stretches
    this.a.t = start;
    this.b.t = end;
    animateSprings(this, [this.a, this.b], () => this.render());
  }

  render() {
    const s = this.a.x;
    const len = Math.max(4, this.b.x - this.a.x);
    const sc = len / this.size;
    const stretch = clamp(sc - 1, -0.3, 0.6);
    const cross = 1 - stretch * 0.22; // thins while stretched, bulges when squeezed
    if (this.axis === "x") {
      this.el.style.transformOrigin = "left center";
      this.el.style.transform = `translate3d(${s.toFixed(2)}px,0,0) scale(${sc.toFixed(4)},${cross.toFixed(4)})`;
    } else {
      this.el.style.transformOrigin = "center top";
      this.el.style.transform = `translate3d(0,${s.toFixed(2)}px,0) scale(${cross.toFixed(4)},${sc.toFixed(4)})`;
    }
  }

  stop() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }
}

/** The selected item among the track's direct children. */
const ACTIVE = ':scope > [aria-selected="true"], :scope > [aria-current="page"], :scope > [aria-checked="true"], :scope > [data-active="true"]';

/**
 * A droplet inside `track` (position: relative), sliding to whichever direct
 * child is selected (aria-selected / aria-current="page" / aria-checked /
 * data-active). Re-measures when `active` changes and when the track resizes.
 * An active item with data-drop-skip (the raised Create button) hides it.
 * While placed, the track carries data-drop="on" so CSS can let the droplet
 * draw the selection instead of the button.
 */
export function Droplet({ track, active, axis = "x", className = "st-droplet" }: { track: RefObject<HTMLElement | null>; active: unknown; axis?: DropAxis; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const spring = useRef<DropletSpring | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    // React runs this child's layout effect before it attaches the parent's ref, so on
    // mount track.current is still null: the droplet always sits directly in its track.
    const host = track.current ?? el?.parentElement ?? null;
    if (!el || !host) return;
    const drop = (spring.current ??= new DropletSpring(el, axis));
    drop.setAxis(axis);
    const place = (instant: boolean) => {
      const target = host.querySelector<HTMLElement>(ACTIVE);
      if (!target || target.hasAttribute("data-drop-skip") || !target.offsetWidth) {
        el.style.opacity = "0";
        host.removeAttribute("data-drop");
        return false;
      }
      el.style.opacity = "";
      if (axis === "x") drop.to(target.offsetLeft, target.offsetWidth, instant);
      else drop.to(target.offsetTop, target.offsetHeight, instant);
      host.setAttribute("data-drop", "on");
      // Keep the selection in view when the track scrolls sideways.
      if (axis === "x" && host.scrollWidth > host.clientWidth + 1) {
        const left = target.offsetLeft - (host.clientWidth - target.offsetWidth) / 2;
        host.scrollTo({ left, behavior: instant || reducedMotion() ? "auto" : "smooth" });
      }
      return true;
    };
    // The observer reports every element once on observe(); when the droplet is already
    // placed, that first report must not cut the slide short. When it could not be placed
    // yet (no box), the first report is the one that places it.
    let initial = place(false);
    let raf = 0;
    const ro = new ResizeObserver(() => {
      if (initial) {
        initial = false;
        return;
      }
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => place(true));
    });
    ro.observe(host);
    host.querySelectorAll(":scope > *").forEach((c) => ro.observe(c));
    return () => {
      ro.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [track, active, axis]);

  useLayoutEffect(() => () => spring.current?.stop(), []);

  return <span ref={ref} className={className} aria-hidden="true" />;
}
