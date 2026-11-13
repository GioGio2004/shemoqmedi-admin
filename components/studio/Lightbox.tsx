"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { lockScroll, unlockScroll, useStudioPortal } from "./chrome";
import { ChevronLeftIcon, ChevronRightIcon, CloseIcon, ExternalIcon } from "./icons";
import { clamp, reducedMotion, springs, tween } from "./liquid";
import { ikUrl, isVideoUrl } from "./media";

// The picture view. It flies out of the picture that was tapped (shared
// element), swipes between pictures, zooms by double-tap, pinch or ctrl+wheel
// (and click with a mouse), pans when zoomed, and closes with a swipe down,
// Escape, or the close button, flying back into its card. A modal <dialog>
// (top layer: above any open sheet), portalled into the Studio's scope.

export type LightboxItem = {
  url: string;
  /** Natural size; the picture is fitted from it (it falls back to 4:5 until the image loads). */
  w?: number;
  h?: number;
  kind?: "image" | "video";
  alt?: string;
};

type Origin = Element | DOMRect | null | undefined;

const fit = (w: number, h: number) => {
  const desk = window.matchMedia("(min-width: 900px)").matches;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const maxW = desk ? vw - 200 : vw;
  const maxH = desk ? vh - 150 : vh;
  const r = Math.min(maxW / w, maxH / h);
  return { w: Math.round(w * r), h: Math.round(h * r) };
};
const rectOf = (o: Origin) => (!o ? null : o instanceof DOMRect ? o : o.getBoundingClientRect());
const inView = (r: DOMRect | null) => !!r && r.width > 0 && r.bottom > 0 && r.top < window.innerHeight && r.right > 0 && r.left < window.innerWidth;

/**
 * Mount it to open it. `start`: the first picture. `origin`: the tapped
 * element (or its rect) for the zoom out of it; `originFor(i)` gives the
 * element to fly back into for picture i (a card's carousel slide), else the
 * origin is used. `onIndexChange` reports swipes (to keep a carousel in step).
 * `onClose` runs after the closing motion; unmount it then.
 */
export function Lightbox({
  items,
  start = 0,
  origin,
  originFor,
  label,
  onClose,
  onIndexChange,
}: {
  items: readonly LightboxItem[];
  start?: number;
  origin?: Origin;
  originFor?: (index: number) => Element | null;
  label?: string;
  onClose: () => void;
  onIndexChange?: (index: number) => void;
}) {
  const portal = useStudioPortal();
  const n = items.length;
  const [index, setIndex] = useState(() => clamp(start, 0, Math.max(0, n - 1)));
  const [bare, setBare] = useState(false);
  const [zoomed, setZoomed] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const bg = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const closeBtn = useRef<HTMLButtonElement>(null);
  // Live gesture state, outside React.
  const s = useRef({ idx: index, z: 1, px: 0, py: 0, closing: false, wheelLock: false, hidden: null as HTMLElement | null, pending: new Set<number>() }).current;
  const cb = useRef({ onClose, onIndexChange, originFor, origin });
  // Sizes slides whose picture loaded while the one on screen was busy (see `loaded`).
  const flushRef = useRef(() => {});
  useEffect(() => {
    cb.current = { onClose, onIndexChange, originFor, origin };
  });

  const cur = () => track.current?.children[s.idx]?.querySelector<HTMLElement>("img, video") ?? null;
  const vw = () => window.innerWidth;

  const applyZoom = (anim: boolean) => {
    const el = cur();
    if (!el) return;
    const t = `translate3d(${s.px.toFixed(1)}px,${s.py.toFixed(1)}px,0) scale(${s.z.toFixed(4)})`;
    if (anim) void tween(el, t, springs().snappy).then(() => flushRef.current());
    else {
      (el as HTMLElement & { _st?: Animation })._st?.cancel();
      el.style.transform = t;
      flushRef.current();
    }
    const z = s.z > 1.01;
    stage.current?.classList.toggle("is-zoomed", z);
    setZoomed(z);
  };
  const bounds = () => {
    const el = cur();
    if (!el) return { x: 0, y: 0 };
    return { x: Math.max(0, (el.offsetWidth * s.z - window.innerWidth) / 2), y: Math.max(0, (el.offsetHeight * s.z - window.innerHeight) / 2) };
  };
  const clampPan = () => {
    const b = bounds();
    s.px = clamp(s.px, -b.x, b.x);
    s.py = clamp(s.py, -b.y, b.y);
  };
  const zoomAt = (x: number, y: number, z: number, anim: boolean) => {
    const z0 = s.z;
    z = clamp(z, 1, 4);
    const cx = x - window.innerWidth / 2;
    const cy = y - window.innerHeight / 2;
    s.px = cx - (cx - s.px) * (z / z0);
    s.py = cy - (cy - s.py) * (z / z0);
    s.z = z;
    if (z <= 1.001) Object.assign(s, { z: 1, px: 0, py: 0 });
    clampPan();
    applyZoom(anim);
  };
  const toggleZoom = (x: number, y: number) => {
    if (cur()?.tagName === "VIDEO") return;
    if (s.z > 1.01) {
      Object.assign(s, { z: 1, px: 0, py: 0 });
      applyZoom(true);
    } else zoomAt(x, y, 2.5, true);
  };
  const resetZoom = () => {
    const el = cur();
    Object.assign(s, { z: 1, px: 0, py: 0 });
    if (el) {
      (el as HTMLElement & { _st?: Animation })._st?.cancel();
      el.style.transform = "";
    }
    stage.current?.classList.remove("is-zoomed");
    setZoomed(false);
  };
  const go = (d: number) => {
    const ni = clamp(s.idx + d, 0, n - 1);
    if (ni !== s.idx) {
      resetZoom();
      s.idx = ni;
      setIndex(ni);
      cb.current.onIndexChange?.(ni);
      flushRef.current();
    }
    if (track.current) void tween(track.current, `translate3d(${-s.idx * vw()}px,0,0)`, springs().snappy);
  };

  const close = () => {
    if (s.closing) return;
    s.closing = true;
    const d = dialog.current;
    const t = track.current;
    const finish = () => {
      if (s.hidden) s.hidden.style.visibility = "";
      if (target) target.style.visibility = "";
      if (d?.open) d.close();
      cb.current.onClose();
    };
    if (t) {
      (t as HTMLElement & { _st?: Animation })._st?.cancel();
      t.style.transform = `translate3d(${-s.idx * vw()}px,0,0)`;
    }
    const el = cur();
    // Fly back into the picture it came from (the slide now showing, if the caller can say which).
    let target: HTMLElement | null = null;
    const back = cb.current.originFor?.(s.idx) ?? (s.idx === start && cb.current.origin instanceof Element ? cb.current.origin : null);
    if (back instanceof HTMLElement) {
      const img = back.tagName === "IMG" || back.tagName === "VIDEO" ? back : back.querySelector<HTMLElement>("img, video");
      if (img && inView(img.getBoundingClientRect())) target = img;
    }
    if (s.hidden && s.hidden !== target) {
      s.hidden.style.visibility = "";
      s.hidden = null;
    }
    const reduce = reducedMotion();
    if (bg.current) bg.current.animate([{ opacity: Number(getComputedStyle(bg.current).opacity) || 1 }, { opacity: 0 }], { duration: reduce ? 160 : 280, easing: "ease-in", fill: "forwards" });
    d?.querySelectorAll<HTMLElement>(".st-lb-chrome").forEach((c) => c.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 160, fill: "forwards" }));
    if (reduce || !el || !target) {
      const a = el?.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 200, fill: "forwards" });
      (a ? a.finished : Promise.resolve()).then(finish, finish);
      return;
    }
    target.style.visibility = "hidden";
    const tr = target.getBoundingClientRect();
    const dx = tr.left + tr.width / 2 - window.innerWidth / 2;
    const dy = tr.top + tr.height / 2 - window.innerHeight / 2;
    tween(el, `translate3d(${dx}px,${dy}px,0) scale(${tr.width / el.offsetWidth},${tr.height / el.offsetHeight})`, springs().snappy).then(finish, finish);
  };
  const closeRef = useRef(close);
  useEffect(() => {
    closeRef.current = close;
  });

  // Sizes one slide's picture to fit the screen.
  const sizeSlide = (i: number) => {
    const el = track.current?.children[i]?.querySelector<HTMLElement>("img, video");
    const it = items[i];
    if (!el || !it) return;
    const nat = el instanceof HTMLImageElement && el.naturalWidth ? { w: el.naturalWidth, h: el.naturalHeight } : null;
    const f = fit(it.w || nat?.w || 1080, it.h || nat?.h || 1350);
    el.style.width = `${f.w}px`;
    el.style.height = `${f.h}px`;
  };
  // Sizes every slide to fit the screen; the track sits on the current one.
  const layout = () => {
    const d = dialog.current;
    const t = track.current;
    if (!d || !t) return;
    d.style.setProperty("--vw", `${vw()}px`);
    for (let i = 0; i < t.children.length; i++) sizeSlide(i);
    s.pending.clear();
    (t as HTMLElement & { _st?: Animation })._st?.cancel();
    t.style.transform = `translate3d(${-s.idx * vw()}px,0,0)`;
  };
  const layoutRef = useRef(layout);
  useEffect(() => {
    layoutRef.current = layout;
  });
  // The slide on screen keeps its size while it flies, is zoomed or is closing.
  const settled = (i: number) => {
    if (i !== s.idx) return true;
    const el = cur() as (HTMLElement & { _st?: Animation }) | null;
    return !s.closing && s.z === 1 && el?._st?.playState !== "running";
  };
  // A picture finished loading: only its slide is sized. The track, a swipe in
  // progress and its spring are left alone; the slide on screen waits until it settles.
  const loaded = (i: number) => {
    if (settled(i)) sizeSlide(i);
    else s.pending.add(i);
  };
  const flush = () => {
    for (const i of s.pending) {
      if (!settled(i)) continue;
      s.pending.delete(i);
      sizeSlide(i);
    }
  };
  const loadedRef = useRef(loaded);
  useEffect(() => {
    loadedRef.current = loaded;
    flushRef.current = flush;
  });

  const resetZoomRef = useRef(resetZoom);
  useEffect(() => {
    resetZoomRef.current = resetZoom;
  });

  // Open: into the top layer, then the zoom out of the origin.
  useLayoutEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (!d.open) d.showModal();
    lockScroll();
    layoutRef.current();
    const reduce = reducedMotion();
    const el = cur();
    const o = cb.current.origin;
    const from = rectOf(o);
    if (!reduce && el && from && inView(from)) {
      const t = el.getBoundingClientRect();
      const dx = from.left + from.width / 2 - (t.left + t.width / 2);
      const dy = from.top + from.height / 2 - (t.top + t.height / 2);
      void tween(el, "translate3d(0px,0px,0) scale(1)", springs().snappy, `translate3d(${dx}px,${dy}px,0) scale(${from.width / t.width},${from.height / t.height})`).then(() => {
        if (s.z === 1 && !s.closing) el.style.transform = "";
        flushRef.current();
      });
      if (o instanceof HTMLElement) {
        const img = o.tagName === "IMG" ? o : o.querySelector<HTMLElement>("img");
        if (img) {
          img.style.setProperty("visibility", "hidden");
          s.hidden = img;
        }
      }
    }
    bg.current?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: reduce ? 160 : 300, easing: "ease-out" });
    d.querySelectorAll<HTMLElement>(".st-lb-chrome").forEach((c) => c.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 300, delay: reduce ? 0 : 120, fill: "backwards" }));
    // The viewer itself takes focus (no ring on the close button after a tap); Tab reaches the buttons.
    const focus = window.setTimeout(() => dialog.current?.focus({ preventScroll: true }), 60);
    const onResize = () => {
      resetZoomRef.current();
      layoutRef.current();
    };
    window.addEventListener("resize", onResize);
    return () => {
      window.clearTimeout(focus);
      window.removeEventListener("resize", onResize);
      if (s.hidden) s.hidden.style.visibility = "";
      if (d.open) d.close();
      unlockScroll();
    };
    // Runs once per mount: the picture view opens when it mounts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Gestures: swipe between, swipe down to close, pan / pinch / double-tap zoom, wheel.
  useEffect(() => {
    const st = stage.current;
    const t = track.current;
    if (!st || !t) return;
    const ptrs = new Map<number, { x: number; y: number }>();
    type G = { mode: null | "pinch" | "pan" | "swipe" | "dismiss" | "none"; sx: number; sy: number; trackX: number; px: number; py: number; lx: number; ly: number; lt: number; vx: number; vy: number; target: EventTarget | null; d0?: number; z0?: number; px0?: number; py0?: number; m0?: { x: number; y: number } };
    let g: G | null = null;
    let lastTap = { t: 0, x: 0, y: 0 };
    let tapTimer = 0;
    const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
    const mid = (a: { x: number; y: number }, b: { x: number; y: number }) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    const matrix = (el: Element) => {
      const tr = getComputedStyle(el).transform;
      if (!tr || tr === "none") return { a: 1, e: 0, f: 0 };
      try {
        const m = new DOMMatrixReadOnly(tr);
        return { a: m.a, e: m.e, f: m.f };
      } catch {
        return { a: 1, e: 0, f: 0 };
      }
    };
    const chrome = () => Array.from(dialog.current?.querySelectorAll<HTMLElement>(".st-lb-chrome") ?? []);

    const down = (e: PointerEvent) => {
      if (s.closing) return;
      if (e.pointerType === "mouse" && e.button !== 0) return;
      if ((e.target as Element).closest("video")) return; // the video's own controls
      try {
        st.setPointerCapture(e.pointerId);
      } catch {
        // Capture is a nicety.
      }
      ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const el = cur();
      if (!el) return;
      if (ptrs.size === 1) {
        const tm = matrix(t);
        (t as HTMLElement & { _st?: Animation })._st?.cancel();
        t.style.transform = `translate3d(${tm.e}px,0,0)`;
        const running = (el as HTMLElement & { _st?: Animation })._st;
        if (running && running.playState === "running") {
          const im = matrix(el);
          running.cancel();
          Object.assign(s, { z: im.a, px: im.e, py: im.f });
          applyZoom(false);
        }
        const now = performance.now();
        g = { mode: null, sx: e.clientX, sy: e.clientY, trackX: tm.e, px: s.px, py: s.py, lx: e.clientX, ly: e.clientY, lt: now, vx: 0, vy: 0, target: e.target };
      } else if (ptrs.size === 2 && el.tagName !== "VIDEO") {
        const [a, b] = Array.from(ptrs.values());
        g = Object.assign(g ?? { sx: 0, sy: 0, trackX: 0, px: 0, py: 0, lx: 0, ly: 0, lt: 0, vx: 0, vy: 0, target: null }, { mode: "pinch" as const, d0: Math.max(10, dist(a, b)), z0: s.z, px0: s.px, py0: s.py, m0: mid(a, b) });
      }
    };
    const move = (e: PointerEvent) => {
      if (!ptrs.has(e.pointerId) || !g) return;
      ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const el = cur();
      if (!el) return;
      if (g.mode === "pinch") {
        if (ptrs.size < 2) return;
        const [a, b] = Array.from(ptrs.values());
        const m = mid(a, b);
        const z = clamp((g.z0! * dist(a, b)) / g.d0!, 0.85, 5);
        const cx = g.m0!.x - window.innerWidth / 2;
        const cy = g.m0!.y - window.innerHeight / 2;
        s.z = z;
        s.px = m.x - window.innerWidth / 2 - (z / g.z0!) * (cx - g.px0!);
        s.py = m.y - window.innerHeight / 2 - (z / g.z0!) * (cy - g.py0!);
        applyZoom(false);
        return;
      }
      const dx = e.clientX - g.sx;
      const dy = e.clientY - g.sy;
      const now = performance.now();
      const dt = now - g.lt;
      if (dt > 0) {
        g.vx = ((e.clientX - g.lx) / dt) * 0.7 + g.vx * 0.3;
        g.vy = ((e.clientY - g.ly) / dt) * 0.7 + g.vy * 0.3;
      }
      g.lx = e.clientX;
      g.ly = e.clientY;
      g.lt = now;
      if (!g.mode) {
        if (Math.hypot(dx, dy) < 8) return;
        if (s.z > 1.02) g.mode = "pan";
        else if (Math.abs(dx) > Math.abs(dy)) g.mode = n > 1 ? "swipe" : "none";
        else g.mode = dy > 0 ? "dismiss" : "none";
      }
      if (g.mode === "swipe") {
        let x = g.trackX + dx;
        const min = -(n - 1) * vw();
        if (x > 0) x *= 0.35;
        if (x < min) x = min + (x - min) * 0.35;
        t.style.transform = `translate3d(${x}px,0,0)`;
      } else if (g.mode === "dismiss") {
        const p = clamp(dy / (window.innerHeight * 0.6), 0, 1);
        el.style.transform = `translate3d(${dx * 0.6}px,${dy}px,0) scale(${1 - p * 0.35})`;
        if (bg.current) bg.current.style.opacity = String(1 - p * 0.9);
        chrome().forEach((c) => (c.style.opacity = String(1 - Math.min(1, p * 3))));
      } else if (g.mode === "pan") {
        const b = bounds();
        let px = g.px + dx;
        let py = g.py + dy;
        if (px > b.x) px = b.x + (px - b.x) * 0.35;
        if (px < -b.x) px = -b.x + (px + b.x) * 0.35;
        if (py > b.y) py = b.y + (py - b.y) * 0.35;
        if (py < -b.y) py = -b.y + (py + b.y) * 0.35;
        s.px = px;
        s.py = py;
        applyZoom(false);
      }
    };
    const up = (e: PointerEvent) => {
      if (!ptrs.has(e.pointerId)) return;
      ptrs.delete(e.pointerId);
      if (!g) return;
      if (g.mode === "pinch") {
        if (ptrs.size === 1) {
          const [r] = Array.from(ptrs.values());
          const now = performance.now();
          g = { mode: "pan", sx: r.x, sy: r.y, trackX: 0, px: s.px, py: s.py, lx: r.x, ly: r.y, lt: now, vx: 0, vy: 0, target: null };
          return;
        }
        if (ptrs.size === 0) {
          if (s.z < 1.02) Object.assign(s, { z: 1, px: 0, py: 0 });
          else clampPan();
          applyZoom(true);
          g = null;
        }
        return;
      }
      if (ptrs.size > 0) return;
      const dx = e.clientX - g.sx;
      const dy = e.clientY - g.sy;
      const el = cur();
      const gg = g;
      g = null;
      if (e.type === "pointercancel" && !gg.mode) return;
      if (!gg.mode) {
        if (e.pointerType === "mouse") {
          // A click on the picture zooms; a click beside it closes.
          if (el && gg.target === el) toggleZoom(e.clientX, e.clientY);
          else closeRef.current();
        } else {
          const now = performance.now();
          if (now - lastTap.t < 300 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 30) {
            window.clearTimeout(tapTimer);
            lastTap.t = 0;
            toggleZoom(e.clientX, e.clientY);
          } else {
            lastTap = { t: now, x: e.clientX, y: e.clientY };
            window.clearTimeout(tapTimer);
            tapTimer = window.setTimeout(() => setBare((b) => !b), 300);
          }
        }
        return;
      }
      if (gg.mode === "swipe") {
        let d = 0;
        if ((dx < -vw() * 0.18 || gg.vx < -0.45) && s.idx < n - 1) d = 1;
        else if ((dx > vw() * 0.18 || gg.vx > 0.45) && s.idx > 0) d = -1;
        go(d);
      } else if (gg.mode === "dismiss") {
        if (dy > 110 || gg.vy > 0.7) closeRef.current();
        else {
          if (el)
            void tween(el, "translate3d(0px,0px,0) scale(1)", springs().bouncy).then(() => {
              if (!s.closing && s.z === 1) el.style.transform = "";
            });
          if (bg.current) {
            bg.current.animate([{ opacity: Number(bg.current.style.opacity) || 1 }, { opacity: 1 }], { duration: 260, easing: "ease-out" });
            bg.current.style.opacity = "";
          }
          chrome().forEach((c) => (c.style.opacity = ""));
        }
      } else if (gg.mode === "pan") {
        s.px += gg.vx * 120;
        s.py += gg.vy * 120;
        clampPan();
        applyZoom(true);
      }
    };
    const wheel = (e: WheelEvent) => {
      if (s.closing) return;
      e.preventDefault();
      if (e.ctrlKey) {
        if (cur()?.tagName !== "VIDEO") zoomAt(e.clientX, e.clientY, s.z * Math.exp(-e.deltaY * 0.01), false);
        return;
      }
      if (s.z > 1.01) {
        s.px -= e.deltaX;
        s.py -= e.deltaY;
        clampPan();
        applyZoom(false);
        return;
      }
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY) && Math.abs(e.deltaX) > 24 && !s.wheelLock) {
        go(e.deltaX > 0 ? 1 : -1);
        s.wheelLock = true;
        window.setTimeout(() => (s.wheelLock = false), 500);
      }
    };
    st.addEventListener("pointerdown", down);
    st.addEventListener("pointermove", move);
    st.addEventListener("pointerup", up);
    st.addEventListener("pointercancel", up);
    st.addEventListener("wheel", wheel, { passive: false });
    return () => {
      window.clearTimeout(tapTimer);
      st.removeEventListener("pointerdown", down);
      st.removeEventListener("pointermove", move);
      st.removeEventListener("pointerup", up);
      st.removeEventListener("pointercancel", up);
      st.removeEventListener("wheel", wheel);
    };
    // The handlers read live state from refs; they bind once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [n]);

  const item = items[index];
  const view = (
    <dialog
      ref={dialog}
      tabIndex={-1}
      className={`st-lb${bare ? " is-bare" : ""}`}
      aria-label={label ? `${label}, picture view` : "Picture view"}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      onKeyDown={(e) => {
        if (e.key === "ArrowRight") {
          e.preventDefault();
          go(1);
        } else if (e.key === "ArrowLeft") {
          e.preventDefault();
          go(-1);
        }
      }}
    >
      <div ref={bg} className="st-lb-bg" />
      <div ref={stage} className="st-lb-stage">
        <div ref={track} className="st-lb-track">
          {items.map((it, i) => {
            const video = it.kind === "video" || (!it.kind && isVideoUrl(it.url));
            const alt = it.alt ?? `${label ? `${label}, ` : ""}picture ${i + 1} of ${n}`;
            return (
              <div key={`${i}:${it.url}`} className="st-lb-slide">
                {video ? (
                  <video src={it.url} controls playsInline preload={i === index ? "auto" : "metadata"} aria-label={alt} />
                ) : (
                  // The picture view is never below the fold: every slide loads at once.
                  <img src={ikUrl(it.url, 2160)} alt={alt} draggable={false} decoding="async" onLoad={() => loadedRef.current(i)} />
                )}
              </div>
            );
          })}
        </div>
      </div>
      <div className="st-lb-top st-lb-chrome">
        <button ref={closeBtn} type="button" className="st-lb-btn lq" onClick={close} aria-label="Close picture view">
          <CloseIcon size={20} />
        </button>
        {n > 1 ? (
          <span className="st-lb-count" aria-live="polite">
            {index + 1} / {n}
          </span>
        ) : (
          <span className="st-lb-count" style={{ visibility: "hidden" }} aria-hidden="true" />
        )}
        {item && (
          <a className="st-lb-btn lq" href={item.url} target="_blank" rel="noopener noreferrer" aria-label="Open the original">
            <ExternalIcon size={20} />
          </a>
        )}
      </div>
      {n > 1 && (
        <>
          <button type="button" className="st-lb-nav st-lb-prev st-lb-btn lq st-lb-chrome" onClick={() => go(-1)} disabled={index === 0} aria-label="Previous picture">
            <ChevronLeftIcon size={20} />
          </button>
          <button type="button" className="st-lb-nav st-lb-next st-lb-btn lq st-lb-chrome" onClick={() => go(1)} disabled={index === n - 1} aria-label="Next picture">
            <ChevronRightIcon size={20} />
          </button>
        </>
      )}
      <div className="st-lb-bottom st-lb-chrome">
        {label && <b>{label}</b>}
        <span>{zoomed ? "Drag to pan" : "Double-tap to zoom"}</span>
      </div>
    </dialog>
  );
  return portal ? createPortal(view, portal) : view;
}
