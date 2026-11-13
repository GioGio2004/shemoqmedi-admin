"use client";

import { useEffect, type RefObject } from "react";

// The Studio's liquid motion: real springs (as CSS linear() curves and as a
// live, interruptible integrator), and the delegated press / specular /
// ripple handling every button gets. useLiquid() is mounted once, in
// StudioShell; nothing else needs to wire it.

export type Ease = { e: string; d: number };
export type SpringName = "bouncy" | "snappy" | "gentle";

/** Integrates a damped spring 0 → 1 and returns a CSS linear() easing plus its duration (ms). */
export function springEase(k: number, c: number): Ease {
  let x = 0;
  let v = 0;
  let t = 0;
  const dt = 1 / 1000;
  const pts = ["0"];
  while (t < 3) {
    for (let i = 0; i < 16; i++) {
      const a = -k * (x - 1) - c * v;
      v += a * dt;
      x += v * dt;
      t += dt;
    }
    pts.push(x.toFixed(4));
    if (t > 0.1 && Math.abs(1 - x) < 0.002 && Math.abs(v) < 0.02) break;
  }
  pts[pts.length - 1] = "1";
  return { e: `linear(${pts.join(", ")})`, d: Math.round(t * 1000) };
}

/** The three springs of the mockup: bouncy (k420 c18), snappy (k480 c34), gentle (k220 c26). */
export const SPRING_PARAMS: Record<SpringName, [number, number]> = { bouncy: [420, 18], snappy: [480, 34], gentle: [220, 26] };

const FALLBACK: Record<SpringName, Ease> = {
  bouncy: { e: "cubic-bezier(.34,1.56,.64,1)", d: 620 },
  snappy: { e: "cubic-bezier(.2,1.1,.3,1)", d: 450 },
  gentle: { e: "cubic-bezier(.22,.61,.36,1)", d: 500 },
};

let cached: Record<SpringName, Ease> | null = null;

/** The springs as easings: linear() curves where the browser has them, cubic-bezier otherwise. */
export function springs(): Record<SpringName, Ease> {
  if (cached) return cached;
  if (typeof window === "undefined") return FALLBACK;
  const ok = !!(window.CSS && CSS.supports && CSS.supports("transition-timing-function", "linear(0, 1)"));
  cached = ok
    ? { bouncy: springEase(...SPRING_PARAMS.bouncy), snappy: springEase(...SPRING_PARAMS.snappy), gentle: springEase(...SPRING_PARAMS.gentle) }
    : FALLBACK;
  return cached;
}

/** Sets --spring-* / --dur-* on an element (the .st root), so CSS transitions use the real springs. */
export function applySpringVars(el: HTMLElement) {
  const s = springs();
  if (s === FALLBACK) return;
  for (const name of ["bouncy", "snappy", "gentle"] as const) {
    el.style.setProperty(`--spring-${name}`, s[name].e);
    el.style.setProperty(`--dur-${name}`, `${s[name].d}ms`);
  }
}

/** Whether the user asked for less motion (read live). */
export function reducedMotion() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

/** A live 1D spring (px, px/s) that can be retargeted mid-flight. */
export class Spring {
  x: number;
  v = 0;
  t: number;
  k = 300;
  c = 28;
  constructor(x = 0) {
    this.x = x;
    this.t = x;
  }
  set(x: number) {
    this.x = this.t = x;
    this.v = 0;
  }
  step(h: number) {
    const a = -this.k * (this.x - this.t) - this.c * this.v;
    this.v += a * h;
    this.x += this.v * h;
  }
  done() {
    return Math.abs(this.x - this.t) < 0.3 && Math.abs(this.v) < 4;
  }
}

export type SpringOwner = { raf: number };

/** Runs springs until they settle, calling render each frame; a new call on the same owner cancels the last. */
export function animateSprings(owner: SpringOwner, list: Spring[], render: () => void, onDone?: () => void) {
  cancelAnimationFrame(owner.raf);
  let last = performance.now();
  const tick = (now: number) => {
    let rem = Math.min(0.05, (now - last) / 1000);
    last = now;
    while (rem > 0) {
      const h = Math.min(1 / 240, rem);
      list.forEach((s) => s.step(h));
      rem -= h;
    }
    const fin = list.every((s) => s.done());
    if (fin) list.forEach((s) => ((s.x = s.t), (s.v = 0)));
    render();
    if (!fin) owner.raf = requestAnimationFrame(tick);
    else {
      owner.raf = 0;
      onDone?.();
    }
  };
  owner.raf = requestAnimationFrame(tick);
}

/** iOS rubber band: how far a drag of `d` past the edge moves, for a dimension `dim`. */
export const rubber = (d: number, dim: number) => (1 - 1 / ((d * 0.55) / dim + 1)) * dim;

/** Animates an element's transform to `to` with a spring easing (WAAPI), leaving `to` set; instant with reduced motion. */
export function tween(el: HTMLElement, to: string, ease: Ease = springs().snappy, from?: string): Promise<void> {
  const f = from || getComputedStyle(el).transform || "none";
  const prev = (el as HTMLElement & { _st?: Animation })._st;
  prev?.cancel();
  el.style.transform = to;
  if (reducedMotion() || !el.animate) return Promise.resolve();
  const a = el.animate([{ transform: f }, { transform: to }], { duration: ease.d, easing: ease.e });
  (el as HTMLElement & { _st?: Animation })._st = a;
  return a.finished.then(
    () => undefined,
    () => undefined,
  );
}

/** What gets the liquid press: every .lq, and the Studio's buttons, chips, tabs and segments. */
export const LIQUID_SELECTOR = ".lq, .st-btn, .st-icon-btn, .st-chip, .st-tab, .st-tab-create, .st-seg > button, .st-net-tabs > button, .st-option, .st-lb-btn";

function ripple(el: HTMLElement, x: number, y: number, r: DOMRect) {
  if (reducedMotion() || !el.animate) return;
  const s = Math.max(r.width, r.height) * 2.2;
  const sp = document.createElement("span");
  sp.className = "st-ripple";
  sp.setAttribute("aria-hidden", "true");
  sp.style.width = sp.style.height = `${s}px`;
  sp.style.left = `${x - s / 2}px`;
  sp.style.top = `${y - s / 2}px`;
  el.appendChild(sp);
  const done = () => sp.remove();
  sp.animate([{ transform: "scale(.08)", opacity: 0.9 }, { transform: "scale(1)", opacity: 0 }], { duration: 620, easing: "cubic-bezier(.2,.7,.3,1)" }).finished.then(done, done);
}

/** Delegated pointer handling under `root`: press squash, jelly release, the --x/--y specular and the ripple. */
export function installLiquid(root: HTMLElement): () => void {
  let pressed: HTMLElement | null = null;
  let start: { x: number; y: number } | null = null;
  // Touch waits a beat before the press shows (like iOS): a finger that lands on a
  // button or card to scroll the feed must not squash and ripple it on the way.
  let pending: { el: HTMLElement; x: number; y: number; r: DOMRect; timer: number } | null = null;
  const TOUCH_DELAY = 90;
  const usable = (el: HTMLElement) => !(el as HTMLButtonElement).disabled && el.getAttribute("aria-disabled") !== "true";

  const activate = (el: HTMLElement, x: number, y: number, r: DOMRect) => {
    el.classList.add("is-pressed");
    pressed = el;
    ripple(el, x, y, r);
  };
  const dropPending = () => {
    if (pending) window.clearTimeout(pending.timer);
    pending = null;
  };

  const down = (e: PointerEvent) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const el = (e.target as Element | null)?.closest<HTMLElement>(LIQUID_SELECTOR);
    if (!el || !root.contains(el) || !usable(el)) return;
    const r = el.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    el.style.setProperty("--x", `${x}px`);
    el.style.setProperty("--y", `${y}px`);
    start = { x: e.clientX, y: e.clientY };
    dropPending();
    if (e.pointerType === "touch") {
      const timer = window.setTimeout(() => {
        pending = null;
        activate(el, x, y, r);
      }, TOUCH_DELAY);
      pending = { el, x, y, r, timer };
    } else activate(el, x, y, r);
  };
  // A cancel (the touch became a scroll) drops everything; a lift shows a quick tap's press first.
  const cancel = () => {
    dropPending();
    pressed?.classList.remove("is-pressed");
    pressed = null;
    start = null;
  };
  const release = () => {
    if (pending) {
      const { el, x, y, r } = pending;
      dropPending();
      activate(el, x, y, r);
      // Let the squash show for a frame before the jelly release.
      requestAnimationFrame(() => requestAnimationFrame(() => el.classList.remove("is-pressed")));
      pressed = null;
      start = null;
      return;
    }
    pressed?.classList.remove("is-pressed");
    pressed = null;
    start = null;
  };
  const move = (e: PointerEvent) => {
    // A press that turns into a scroll lets go (sooner while the touch press is still pending).
    if (start) {
      const d = Math.hypot(e.clientX - start.x, e.clientY - start.y);
      if (pending && d > 10) cancel();
      else if (pressed && d > 24) cancel();
    }
    if (e.pointerType !== "mouse") return;
    const el = (e.target as Element | null)?.closest<HTMLElement>(`${LIQUID_SELECTOR}, .st-card, .st-tile`);
    if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty("--x", `${e.clientX - r.left}px`);
    el.style.setProperty("--y", `${e.clientY - r.top}px`);
  };

  root.addEventListener("pointerdown", down, { passive: true });
  root.addEventListener("pointermove", move, { passive: true });
  window.addEventListener("pointerup", release, { passive: true });
  window.addEventListener("pointercancel", cancel, { passive: true });
  window.addEventListener("blur", cancel);
  return () => {
    root.removeEventListener("pointerdown", down);
    root.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", release);
    window.removeEventListener("pointercancel", cancel);
    window.removeEventListener("blur", cancel);
    cancel();
  };
}

/** Mount once on the Studio root: real spring curves in CSS, and the liquid press for every button under it. */
export function useLiquid(rootRef: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    applySpringVars(root);
    return installLiquid(root);
  }, [rootRef]);
}
