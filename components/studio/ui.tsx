"use client";

import { Component, useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { errorMessage } from "@/components/admin/format";
import { lockScroll, trapTab, unlockScroll, useStudioTitle } from "./chrome";
import { Droplet } from "./Droplet";
import { CloseIcon } from "./icons";
import { Spring, animateSprings, clamp, reducedMotion, rubber, springs } from "./liquid";

// Small building blocks shared by every Studio screen. The design system they
// draw with is documented in docs/studio-glass.md.

const isDesk = () => typeof window !== "undefined" && window.matchMedia("(min-width: 900px)").matches;

/**
 * The page title block, iOS style: an eyebrow (index + section), a large
 * title (it hands itself to the top bar, which shows it small once the large
 * one scrolls away), an optional line and actions.
 */
export function PageHead({ index, section, title, lede, actions }: { index?: string; section: string; title: string; lede?: ReactNode; actions?: ReactNode }) {
  useStudioTitle(title);
  return (
    <header className="st-head st-in">
      <p className="st-eyebrow">
        {index && <b>{index}</b>}
        <span>{section}</span>
      </p>
      <div className="st-head-row">
        <h1 className="st-h1" data-large-title="">
          {title}
        </h1>
        {actions}
      </div>
      {lede && <p className="st-lede">{lede}</p>}
    </header>
  );
}

export type SheetProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  /** A small line above the title ("Waiting · Carousel · 6"). */
  eyebrow?: ReactNode;
  /** A line under the title. */
  subtitle?: ReactNode;
  /** Pinned under the scrolling body, on glass (the sheet's main actions). */
  footer?: ReactNode;
  /** Extra buttons beside Close in the header. */
  headerActions?: ReactNode;
  /** "auto" fits its content; "large" takes the screen height (a detail view). */
  size?: "auto" | "large";
  /** With size "large": a medium detent (about 44% down) to rest at as well. */
  detents?: boolean;
  /** From 900px: a wide centred modal (two columns) instead of the 560px one. */
  wide?: boolean;
  /** A floating panel with all four corners rounded (the time picker). */
  floating?: boolean;
};

/**
 * The iOS glass sheet: from the bottom on phones (grabber; drag it, or the
 * content from its top, with rubber-banding; a flick snaps to the nearest
 * detent or dismisses), a centred modal from 900px. A native modal <dialog>
 * underneath: the page behind is inert, focus stays in, Escape and a tap on
 * the backdrop close it, focus returns where it was. Its content mounts only
 * while open, so each opening starts fresh. `onClose` is called for every
 * way of closing; the parent then sets open=false and the sheet slides away.
 */
export function Sheet({ open, onClose, title, children, eyebrow, subtitle, footer, headerActions, size = "auto", detents = false, wide = false, floating = false }: SheetProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const scrimRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  // The content stays while the sheet slides away, then unmounts. It mounts
  // only once the dialog is shown, so it measures a real box from its first
  // effect (the wheels' and the carousel's start, the droplet).
  const [shown, setShown] = useState(false);
  const stRef = useRef({ y: 0, H: 1, raf: 0, v: 0, token: 0, locked: false, open, entering: false });
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
    stRef.current.open = open;
  });

  const setY = useCallback(
    (y: number) => {
      const st = stRef.current;
      st.y = y;
      const p = panelRef.current;
      const s = scrimRef.current;
      if (p) p.style.transform = y ? `translate3d(0,${y.toFixed(2)}px,0)` : "";
      if (s) s.style.opacity = String(clamp(1 - y / st.H, 0, 1));
    },
    [],
  );
  const springTo = useCallback(
    (to: number, v0: number, done?: () => void, closing = false) => {
      const st = stRef.current;
      const s = new Spring(st.y);
      s.t = to;
      s.v = v0;
      s.k = closing ? 360 : 300;
      s.c = closing ? 36 : 30;
      animateSprings(st, [s], () => setY(s.x), done);
    },
    [setY],
  );
  const medium = useCallback(() => (size === "large" && detents ? Math.round(stRef.current.H * 0.44) : null), [size, detents]);

  // Open and close, with the motion. A layout effect: the dialog is shown and
  // its content mounted before the first paint, so there is no bare scrim frame.
  useLayoutEffect(() => {
    const st = stRef.current;
    const d = ref.current;
    const p = panelRef.current;
    const s = scrimRef.current;
    if (!d) return;
    if (open) {
      st.token++; // cancels a close still running
      if (!st.locked) {
        lockScroll();
        st.locked = true;
      }
      if (d.open) {
        // Opened again while sliding away: come back up from where it is.
        cancelAnimationFrame(st.raf);
        p?.getAnimations().forEach((a) => a.cancel());
        s?.getAnimations().forEach((a) => a.cancel());
        if (isDesk() || reducedMotion()) setY(0);
        else springTo(0, 0);
        return;
      }
      d.showModal();
      // Focus the sheet itself, not its first button: a ring on the close button
      // after a tap reads as a selection. Tab still reaches the close button first.
      d.focus({ preventScroll: true });
      // The content mounts now, inside the shown dialog; the entrance runs once it is there.
      st.entering = true;
      setShown(true);
      return;
    }
    const token = ++st.token;
    const finish = () => {
      if (token !== st.token) return;
      cancelAnimationFrame(st.raf);
      if (d.open) d.close();
      if (st.locked) {
        unlockScroll();
        st.locked = false;
      }
      p?.getAnimations().forEach((a) => a.cancel());
      s?.getAnimations().forEach((a) => a.cancel());
      st.y = 0;
      if (p) p.style.transform = "";
      if (s) s.style.opacity = "";
      setShown(false);
    };
    if (!d.open || !p || !s) return finish();
    if (reducedMotion() || isDesk()) {
      cancelAnimationFrame(st.raf);
      const fade = reducedMotion();
      s.animate([{ opacity: Number(s.style.opacity || 1) }, { opacity: 0 }], { duration: fade ? 180 : 240, fill: "forwards" });
      p.animate(fade ? [{ opacity: 1 }, { opacity: 0 }] : [{ opacity: 1, transform: "none" }, { opacity: 0, transform: "translateY(18px) scale(.96)" }], { duration: fade ? 180 : 240, easing: "cubic-bezier(.4,0,1,1)", fill: "forwards" }).finished.then(finish, finish);
      return;
    }
    st.entering = false;
    st.H = p.offsetHeight || st.H;
    springTo(st.H, st.v, finish, true);
  }, [open, setY, springTo]);

  // The entrance, once the content is in the shown dialog.
  useLayoutEffect(() => {
    const st = stRef.current;
    const p = panelRef.current;
    const s = scrimRef.current;
    if (!open || !shown || !st.entering || !p || !s) return;
    st.entering = false;
    p.getAnimations().forEach((a) => a.cancel());
    s.getAnimations().forEach((a) => a.cancel());
    st.H = p.offsetHeight || window.innerHeight;
    st.v = 0;
    if (reducedMotion()) {
      setY(0);
      p.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200 });
      s.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200 });
    } else if (isDesk()) {
      setY(0);
      const e = springs().snappy;
      p.animate([{ opacity: 0, transform: "translateY(26px) scale(.955)" }, { opacity: 1, transform: "none" }], { duration: e.d + 60, easing: e.e });
      s.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 260, easing: "ease-out" });
    } else {
      setY(st.H);
      springTo(0, 0);
    }
  }, [open, shown, setY, springTo]);

  // Released on unmount mid-way (a route change with the sheet open).
  useEffect(() => {
    const st = stRef.current;
    return () => {
      cancelAnimationFrame(st.raf);
      if (st.locked) {
        unlockScroll();
        st.locked = false;
      }
    };
  }, []);

  const requestClose = useCallback(
    (velocity = 0) => {
      stRef.current.v = velocity;
      onCloseRef.current();
    },
    [],
  );

  // Where a drag lets go: the nearest detent after a short projection of the flick, or closed.
  const release = useCallback(
    (v: number) => {
      const st = stRef.current;
      const med = medium();
      const proj = st.y + v * 170;
      const opts = med === null ? [0, st.H] : [0, med, st.H];
      let best = 0;
      for (const o of opts) if (Math.abs(o - proj) < Math.abs(best - proj)) best = o;
      if (best === st.H) requestClose(v * 1000);
      else springTo(best, v * 1000);
    },
    [medium, requestClose, springTo],
  );

  // Dragging by the header (grabber and title).
  const drag = useRef<{ id: number; y0: number; sy: number; ly: number; lt: number; v: number; moved: boolean } | null>(null);
  const onHeadDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isDesk() || !open) return;
    const st = stRef.current;
    if ((e.target as Element).closest("button, a, input, textarea, select")) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    cancelAnimationFrame(st.raf);
    st.H = panelRef.current?.offsetHeight || st.H;
    drag.current = { id: e.pointerId, y0: e.clientY, sy: st.y, ly: e.clientY, lt: performance.now(), v: 0, moved: false };
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Capture is a nicety.
    }
  };
  const onHeadMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const g = drag.current;
    if (!g || e.pointerId !== g.id) return;
    const st = stRef.current;
    const raw = g.sy + (e.clientY - g.y0);
    if (Math.abs(e.clientY - g.y0) > 3) g.moved = true;
    setY(raw < 0 ? -rubber(-raw, st.H) : raw);
    const now = performance.now();
    g.v = ((e.clientY - g.ly) / Math.max(1, now - g.lt)) * 0.7 + g.v * 0.3;
    g.ly = e.clientY;
    g.lt = now;
  };
  const onHeadUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const g = drag.current;
    if (!g || e.pointerId !== g.id) return;
    drag.current = null;
    const med = medium();
    if (!g.moved) {
      // A tap on the grabber toggles the detents.
      if (med !== null) springTo(stRef.current.y > 1 ? 0 : med, 0);
      return;
    }
    release(g.v);
  };

  // Dragging the content down from its top (or up from the medium detent).
  useEffect(() => {
    const body = bodyRef.current;
    const st = stRef.current;
    if (!shown || !body) return;
    let t: { y0: number; x0: number; sy: number; active: boolean; ly: number; lt: number; v: number } | null = null;
    const start = (e: TouchEvent) => {
      if (isDesk() || e.touches.length > 1) return;
      if ((e.target as Element).closest("textarea, input, select, [data-no-sheet-drag], .st-car-track, .st-scroll-x, .st-wheel")) return;
      const p = e.touches[0];
      t = { y0: p.clientY, x0: p.clientX, sy: st.y, active: false, ly: p.clientY, lt: performance.now(), v: 0 };
    };
    const move = (e: TouchEvent) => {
      if (!t) return;
      const p = e.touches[0];
      const dy = p.clientY - t.y0;
      const dx = p.clientX - t.x0;
      if (!t.active) {
        if (Math.abs(dy) < 6 && Math.abs(dx) < 6) return;
        if (Math.abs(dx) > Math.abs(dy)) {
          t = null;
          return;
        }
        if ((dy > 0 && body.scrollTop <= 0) || (dy < 0 && st.y > 1)) {
          t.active = true;
          t.y0 = p.clientY;
          t.sy = st.y;
          st.H = panelRef.current?.offsetHeight || st.H;
          cancelAnimationFrame(st.raf);
        } else {
          t = null;
          return;
        }
      }
      e.preventDefault();
      const raw = t.sy + (p.clientY - t.y0);
      setY(raw < 0 ? -rubber(-raw, st.H) : raw);
      const now = performance.now();
      t.v = ((p.clientY - t.ly) / Math.max(1, now - t.lt)) * 0.7 + t.v * 0.3;
      t.ly = p.clientY;
      t.lt = now;
    };
    const end = () => {
      if (t?.active) release(t.v);
      t = null;
    };
    body.addEventListener("touchstart", start, { passive: true });
    body.addEventListener("touchmove", move, { passive: false });
    body.addEventListener("touchend", end);
    body.addEventListener("touchcancel", end);
    return () => {
      body.removeEventListener("touchstart", start);
      body.removeEventListener("touchmove", move);
      body.removeEventListener("touchend", end);
      body.removeEventListener("touchcancel", end);
    };
  }, [shown, setY, release]);

  return (
    <dialog
      ref={ref}
      tabIndex={-1}
      className="st-sheet"
      data-size={size}
      data-wide={wide || undefined}
      data-floating={floating || undefined}
      aria-labelledby={titleId}
      onCancel={(e) => {
        // Escape: slide away first, then close.
        e.preventDefault();
        requestClose();
      }}
      onClose={() => {
        // Closed by the browser itself (a second Escape): keep the parent in step.
        if (stRef.current.open) requestClose();
      }}
      onKeyDown={(e) => {
        if (ref.current) trapTab(e, ref.current);
      }}
    >
      <div ref={scrimRef} className="st-sheet-scrim" aria-hidden="true" onClick={() => requestClose()} />
      {shown && (
        <div ref={panelRef} className="st-sheet-panel">
          <div className="st-sheet-head" onPointerDown={onHeadDown} onPointerMove={onHeadMove} onPointerUp={onHeadUp} onPointerCancel={onHeadUp}>
            <span className="st-sheet-grip" aria-hidden="true" />
            <div className="st-sheet-row">
              <div className="st-sheet-titles">
                {eyebrow && <p className="st-eyebrow">{eyebrow}</p>}
                <h2 id={titleId} className="st-sheet-title">
                  {title}
                </h2>
                {subtitle && <p className="st-sheet-sub">{subtitle}</p>}
              </div>
              <div className="st-sheet-head-actions">
                {headerActions}
                <button type="button" className="st-icon-btn" onClick={() => requestClose()} aria-label="Close">
                  <CloseIcon size={20} />
                </button>
              </div>
            </div>
          </div>
          <div ref={bodyRef} className="st-sheet-in">
            {children}
          </div>
          {footer && <div className="st-sheet-footer">{footer}</div>}
        </div>
      )}
    </dialog>
  );
}

/**
 * Why the sheet's action failed, inside the sheet, next to the form it is
 * about (a toast drops in too, but leaves after a few seconds).
 */
export function SheetError({ error }: { error: unknown }) {
  if (error === null || error === undefined) return null;
  return (
    <p className="st-callout" data-tone="error" role="alert">
      {errorMessage(error)}
    </p>
  );
}

/** A yes/no sheet instead of confirm(). `onConfirm` may be async: the sheet waits, then closes. */
export function ConfirmSheet({
  open,
  onClose,
  title,
  body,
  confirmLabel,
  onConfirm,
  tone = "ink",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  body: ReactNode;
  confirmLabel: string;
  onConfirm: () => Promise<unknown> | void;
  tone?: "ink";
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [wasOpen, setWasOpen] = useState(open);
  // Each opening starts without the last one's error.
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setError(null);
  }
  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
      onClose();
    } catch (err) {
      // Keep the sheet open to try again, with the reason in it.
      setError(err);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <button type="button" className="st-btn st-btn-ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="st-btn" data-tone={tone} onClick={confirm} disabled={busy} data-busy={busy}>
            {confirmLabel}
          </button>
        </>
      }
    >
      <div className="st-note">{body}</div>
      <SheetError error={error} />
    </Sheet>
  );
}

/** An on/off switch (role="switch") with the droplet knob: it stretches while pressed and springs across. */
export function Switch({ checked, onChange, label, hint, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; hint?: ReactNode; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={checked} className="st-switch" onClick={() => onChange(!checked)} disabled={disabled}>
      <span>
        {label}
        {hint && <small>{hint}</small>}
      </span>
      <span className="st-switch-track" aria-hidden="true">
        <span className="st-switch-thumb" />
      </span>
    </button>
  );
}

export type SegmentedOption<T extends string> = { value: T; label: ReactNode; count?: number; disabled?: boolean; id?: string; controls?: string };

/**
 * A segmented control on glass with the liquid droplet: it stretches from the
 * old option to the new one. `kind="tabs"` (default) is an ARIA tablist (give
 * each option `id`/`controls` to tie it to its panel); `kind="radio"` is a
 * radiogroup for a plain choice. Arrow keys, Home and End move the choice.
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  labelledBy,
  kind = "tabs",
  size,
  block = false,
  className = "",
}: {
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  label?: string;
  labelledBy?: string;
  kind?: "tabs" | "radio";
  size?: "sm";
  block?: boolean;
  className?: string;
}) {
  const track = useRef<HTMLDivElement>(null);
  const tabs = kind === "tabs";
  const enabled = options.filter((o) => !o.disabled);
  const move = (e: React.KeyboardEvent) => {
    const i = enabled.findIndex((o) => o.value === value);
    let next: number | null = null;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = (i + 1) % enabled.length;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = (i - 1 + enabled.length) % enabled.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = enabled.length - 1;
    if (next === null) return;
    e.preventDefault();
    const v = enabled[next].value;
    onChange(v);
    track.current?.querySelector<HTMLElement>(`[data-value="${CSS.escape(v)}"]`)?.focus();
  };
  return (
    <div
      ref={track}
      className={`st-seg${block ? " st-seg-block" : ""}${size === "sm" ? " st-seg-sm" : ""}${className ? ` ${className}` : ""}`}
      role={tabs ? "tablist" : "radiogroup"}
      aria-label={label}
      aria-labelledby={labelledBy}
      onKeyDown={move}
    >
      <Droplet track={track} active={value} />
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            id={o.id}
            type="button"
            role={tabs ? "tab" : "radio"}
            aria-selected={tabs ? on : undefined}
            aria-checked={tabs ? undefined : on}
            aria-controls={tabs ? o.controls : undefined}
            tabIndex={on ? 0 : -1}
            disabled={o.disabled}
            data-value={o.value}
            onClick={() => !on && onChange(o.value)}
          >
            {o.label}
            {o.count !== undefined && <span className="st-seg-count">{o.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

export function Skel({ className = "", style }: { className?: string; style?: React.CSSProperties }) {
  return <span className={`st-skel ${className}`} style={style} aria-hidden="true" />;
}

/** A labelled field; the label points at the first control inside through `id`. */
export function Field({ label, id, aside, hint, children }: { label: string; id: string; aside?: ReactNode; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="st-field">
      <label className="st-label" htmlFor={id}>
        <span>{label}</span>
        {aside}
      </label>
      {children}
      {hint && <p className="st-note">{hint}</p>}
    </div>
  );
}

/** Keeps one broken piece (a stale deep link, say) from taking the screen down. */
export class ErrorBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
