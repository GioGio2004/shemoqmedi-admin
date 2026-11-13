"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { reducedMotion, rubber, springs, tween } from "../liquid";
import { TrashIcon } from "../icons";

// One list row that swipes left to delete, the iOS way: a short swipe rests
// open on a Delete button, a long one (or a flick) deletes at once. The row's
// own delete button stays for keyboard, screen readers and a mouse, so the
// swipe is only a shortcut. Pure presentation: `onDelete` does the work (it
// rejects when the delete failed, and the row slides back).

const ACTION = 92; // the resting Delete button, px
const ARM = 0.55; // past this share of the row, letting go deletes

type Gesture = { id: number; x0: number; y0: number; base: number; x: number; mode: "?" | "x" | "none"; w: number; lastX: number; lastT: number; v: number };

export function SwipeRow({ label, onDelete, children, className = "", style }: { label: string; onDelete: () => Promise<unknown>; children: ReactNode; className?: string; style?: React.CSSProperties }) {
  const rowRef = useRef<HTMLLIElement>(null);
  const foreRef = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const offset = useRef(0);
  const [open, setOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);

  function paint(x: number) {
    offset.current = x;
    const fore = foreRef.current;
    if (fore) fore.style.transform = x ? `translate3d(${x}px, 0, 0)` : "";
    const row = rowRef.current;
    if (!row) return;
    row.style.setProperty("--st-swipe", `${Math.max(0, -x)}px`);
    // Far enough that letting go deletes.
    row.toggleAttribute("data-armed", x < -row.offsetWidth * ARM);
  }

  async function settle(x: number, ease = springs().snappy) {
    const fore = foreRef.current;
    if (!fore) return;
    const from = `translate3d(${offset.current}px, 0, 0)`;
    rowRef.current?.removeAttribute("data-drag");
    rowRef.current?.removeAttribute("data-armed");
    rowRef.current?.style.setProperty("--st-swipe", `${Math.max(0, -x)}px`);
    offset.current = x;
    await tween(fore, `translate3d(${x}px, 0, 0)`, ease, from);
    if (x === 0 && foreRef.current) foreRef.current.style.transform = "";
  }

  function close() {
    setOpen(false);
    void settle(0);
  }

  async function commit() {
    const w = rowRef.current?.offsetWidth ?? 360;
    setLeaving(true);
    setOpen(false);
    await settle(-w - 24, springs().gentle);
    // Then the gap closes, so the rows below slide up instead of jumping.
    const row = rowRef.current;
    if (row && row.animate && !reducedMotion()) {
      const h = row.offsetHeight;
      row.style.overflow = "hidden";
      await row.animate([{ height: `${h}px`, opacity: 1 }, { height: "0px", opacity: 0 }], { duration: 220, easing: "cubic-bezier(.2,.8,.2,1)", fill: "forwards" }).finished.catch(() => undefined);
    }
    // Deleted from the keyboard: focus moves to a neighbour's delete, not to the page.
    if (row?.contains(document.activeElement)) {
      const next = (row.nextElementSibling ?? row.previousElementSibling)?.querySelector<HTMLElement>(".st-reminders-del");
      next?.focus();
    }
    try {
      await onDelete();
    } catch {
      // The caller already said why; the row comes back.
      setLeaving(false);
      if (row) {
        row.getAnimations().forEach((a) => a.cancel());
        row.style.overflow = "";
      }
      await settle(0, springs().bouncy);
    }
  }

  // An open row closes when something else is touched.
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!rowRef.current?.contains(e.target as Node)) close();
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && close();
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", esc);
    };
    // close() only touches refs and state setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (leaving || e.button !== 0 || (e.target as HTMLElement).closest("button, a, input, textarea, select")) return;
    gesture.current = { id: e.pointerId, x0: e.clientX, y0: e.clientY, base: offset.current, x: offset.current, mode: "?", w: rowRef.current?.offsetWidth ?? 360, lastX: e.clientX, lastT: e.timeStamp, v: 0 };
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const g = gesture.current;
    if (!g || g.id !== e.pointerId) return;
    const dx = e.clientX - g.x0;
    const dy = e.clientY - g.y0;
    if (g.mode === "?") {
      if (Math.hypot(dx, dy) < 8) return;
      g.mode = Math.abs(dx) > Math.abs(dy) * 1.2 ? "x" : "none";
      if (g.mode === "x") {
        e.currentTarget.setPointerCapture(e.pointerId);
        rowRef.current?.setAttribute("data-drag", "");
        // Take over from a spring still running (tween keeps it on the element).
        (e.currentTarget as HTMLElement & { _st?: Animation })._st?.cancel();
      }
    }
    if (g.mode !== "x") return;
    const dt = Math.max(1, e.timeStamp - g.lastT);
    g.v = g.v * 0.4 + (((e.clientX - g.lastX) / dt) * 1000) * 0.6;
    g.lastX = e.clientX;
    g.lastT = e.timeStamp;
    let x = g.base + dx;
    if (x > 0) x = rubber(x, g.w) * 0.5; // nothing to the left: a little give only
    g.x = x;
    paint(x);
  }

  function onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    const g = gesture.current;
    if (!g || g.id !== e.pointerId) return;
    gesture.current = null;
    if (g.mode !== "x") return;
    const { x, v, w } = g;
    if (x < -w * ARM || (v < -1100 && x < -40)) void commit();
    else if (x < -ACTION / 2 || (v < -450 && x < -16)) {
      setOpen(true);
      void settle(-ACTION, springs().bouncy);
    } else close();
  }

  function onPointerCancel(e: React.PointerEvent<HTMLDivElement>) {
    const g = gesture.current;
    if (!g || g.id !== e.pointerId) return;
    gesture.current = null;
    if (g.mode !== "x") return;
    if (open) void settle(-ACTION);
    else close();
  }

  // A tap on an open row closes it instead of doing anything else.
  function onClickCapture(e: React.MouseEvent) {
    if (open && !(e.target as HTMLElement).closest(".st-reminders-swipe-del, .st-reminders-del")) {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  }

  return (
    <li ref={rowRef} className={`st-reminders-row ${className}`} data-open={open} data-leaving={leaving} style={style}>
      <div className="st-reminders-swipe" aria-hidden={!open}>
        <button type="button" className="st-reminders-swipe-del" tabIndex={open ? 0 : -1} onClick={() => void commit()} aria-label={label}>
          <TrashIcon size={20} />
          <span>Delete</span>
        </button>
      </div>
      <div
        ref={foreRef}
        className="st-reminders-fore"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onClickCapture={onClickCapture}
      >
        <div className="st-reminders-main">{children}</div>
        {/* Always there (keyboard, screen readers, a mouse): the same delete as the swipe. */}
        <button type="button" className="st-icon-btn is-plain st-reminders-del" aria-label={label} onClick={() => void commit()} disabled={leaving}>
          <TrashIcon size={20} />
        </button>
      </div>
    </li>
  );
}
