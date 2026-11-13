"use client";

import { useEffect, useId, useRef, useState } from "react";
import { deviceTimeNote, formatTbilisi, parseTbilisiInput, quickTimes, relativeTime, suggestedTime, toTbilisiInput } from "@/lib/studio/time";
import { useNow } from "./hooks";
import { clamp, reducedMotion } from "./liquid";
import { Sheet, SheetError } from "./ui";

/**
 * Pick a moment in Tbilisi time (schedule a post, or a reminder's time): the
 * iOS wheels (day, hour, minute) on a floating glass panel, with one-tap
 * suggestions above them. Past times are refused. `onPick` may be async; the
 * sheet waits and closes when it resolves.
 */
export function TimeSheet({
  open,
  onClose,
  title,
  confirmLabel,
  initial,
  onPick,
  intro,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  confirmLabel: string;
  initial?: number | null;
  onPick: (at: number) => Promise<unknown> | void;
  intro?: React.ReactNode;
}) {
  return (
    <Sheet open={open} onClose={onClose} title={title} floating>
      <TimeForm initial={initial} confirmLabel={confirmLabel} onPick={onPick} onDone={onClose} intro={intro} />
    </Sheet>
  );
}

const DAY = 86_400_000;
const WH = 40; // one wheel row, px
const pad = (n: number) => String(n).padStart(2, "0");
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const HOURS = Array.from({ length: 24 }, (_, i) => pad(i));
const MINUTES = Array.from({ length: 60 }, (_, i) => pad(i));

type Day = { date: string; label: string };

/** Tbilisi days from today: a year ahead (as far as a reminder may go), more when `until` lies further out. */
function buildDays(now: number, until: number): Day[] {
  const today = toTbilisiInput(now).slice(0, 10);
  const count = Math.max(367, Math.ceil((until - now) / DAY) + 2);
  const out: Day[] = [];
  for (let i = 0; i < count; i++) {
    const date = toTbilisiInput(now + i * DAY).slice(0, 10);
    if (out.length && out[out.length - 1].date === date) continue;
    const [y, m, d] = date.split("-").map(Number);
    const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    const label = date === today ? "Today" : out.length === 1 ? "Tomorrow" : `${WEEKDAYS[wd]} ${d} ${MONTHS[m - 1]}`;
    out.push({ date, label });
  }
  return out;
}

type Pick = { day: number; h: number; m: number };

function pickOf(ms: number, days: Day[]): Pick {
  const v = toTbilisiInput(ms);
  const day = Math.max(0, days.findIndex((d) => d.date === v.slice(0, 10)));
  return { day, h: Number(v.slice(11, 13)), m: Number(v.slice(14, 16)) };
}

function TimeForm({ initial, confirmLabel, onPick, onDone, intro }: { initial?: number | null; confirmLabel: string; onPick: (at: number) => Promise<unknown> | void; onDone: () => void; intro?: React.ReactNode }) {
  const id = useId();
  const now = useNow(10_000);
  const [{ days, first }] = useState(() => {
    const start = Date.now();
    const at = initial && initial > start ? initial : suggestedTime(start);
    const list = buildDays(start, at);
    return { days: list, first: pickOf(at, list) };
  });
  const [pick, setPick] = useState<Pick>(first);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const at = parseTbilisiInput(`${days[pick.day].date}T${pad(pick.h)}:${pad(pick.m)}`);
  const past = at !== null && at < now - 60_000;
  const device = at !== null ? deviceTimeNote(at) : null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (at === null || past) {
      // Refused: the panel shakes its head.
      if (!reducedMotion()) formRef.current?.animate([0, -9, 8, -5, 3, 0].map((x) => ({ transform: `translateX(${x}px)` })), { duration: 380, easing: "ease-out" });
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onPick(at);
      onDone();
    } catch (err) {
      // Stay open, with the reason in the sheet.
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form ref={formRef} className="st-stack" onSubmit={submit} aria-describedby={`${id}-sum`}>
      {intro && <div className="st-note">{intro}</div>}
      <div className="st-scroll-x" role="group" aria-label="Suggested times">
        {quickTimes(now).map((q) => (
          <button key={q.label} type="button" className="st-chip st-chip-sm" aria-pressed={at === q.at} onClick={() => setPick(pickOf(q.at, days))}>
            {q.label}
          </button>
        ))}
      </div>
      <p id={`${id}-sum`} className={`st-pk-sum${past ? " is-past" : ""}`} aria-live="polite">
        {at === null ? "Pick a day and time." : past ? "That time has passed." : formatTbilisi(at, now)}
        {at !== null && !past && (
          <small>
            {relativeTime(at, now)}
            {device ? ` · ${device}` : ""}
          </small>
        )}
      </p>
      <div className="st-wheels">
        <div className="st-wheel-band" aria-hidden="true" />
        <Wheel className="is-day" label="Day" items={days.map((d) => d.label)} value={pick.day} onChange={(day) => setPick((p) => ({ ...p, day }))} />
        <Wheel label="Hour" items={HOURS} value={pick.h} onChange={(h) => setPick((p) => ({ ...p, h }))} />
        <span className="st-wheel-colon" aria-hidden="true">
          :
        </span>
        <Wheel label="Minute" items={MINUTES} value={pick.m} onChange={(m) => setPick((p) => ({ ...p, m }))} />
      </div>
      <p className="st-pk-tz">Tbilisi time, GMT+4</p>
      <SheetError error={error} />
      <div className="st-sheet-foot">
        <button type="button" className="st-btn st-btn-ghost" onClick={onDone} disabled={busy}>
          Cancel
        </button>
        <button type="submit" className="st-btn" disabled={busy || at === null} aria-disabled={past || undefined} data-busy={busy}>
          {confirmLabel}
        </button>
      </div>
    </form>
  );
}

/**
 * One snap wheel (a listbox): scroll, drag or tap a row; Arrow keys, Page
 * keys, Home and End move it. Rows curve away from the band like iOS.
 */
function Wheel({ items, value, onChange, label, className = "" }: { items: string[]; value: number; onChange: (i: number) => void; label: string; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const uid = useId();
  const emitted = useRef(value);
  const cbRef = useRef(onChange);
  useEffect(() => {
    cbRef.current = onChange;
  });

  // Rows fade and tilt with their distance from the band.
  const paint = () => {
    const el = ref.current;
    if (!el) return 0;
    const mid = el.scrollTop + el.clientHeight / 2;
    const rows = el.querySelectorAll<HTMLElement>(".st-wi");
    rows.forEach((row, i) => {
      const d = (80 + i * WH + WH / 2 - mid) / WH;
      if (Math.abs(d) > 3.2) {
        // Far rows (a year of days) are only written when they change.
        if (row.style.opacity !== "0") {
          row.style.opacity = "0";
          row.style.transform = "";
        }
      } else {
        row.style.opacity = (1 - Math.min(1, Math.abs(d) * 0.3)).toFixed(3);
        row.style.transform = `scale(${(1 - Math.min(0.25, Math.abs(d) * 0.07)).toFixed(3)}, ${Math.cos(clamp(d, -3, 3) * 0.38).toFixed(3)})`;
      }
    });
    return clamp(Math.round(el.scrollTop / WH), 0, items.length - 1);
  };
  const paintRef = useRef(paint);
  useEffect(() => {
    paintRef.current = paint;
  });

  // Follows `value` when it changes from outside (a suggestion chip); the first time without motion.
  const mounted = useRef(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const here = clamp(Math.round(el.scrollTop / WH), 0, items.length - 1);
    if (!mounted.current) {
      mounted.current = true;
      el.scrollTop = value * WH;
      emitted.current = value;
      paintRef.current();
      return;
    }
    if (here === value && Math.abs(el.scrollTop - value * WH) < 1) return;
    if (emitted.current === value && here === value) return;
    emitted.current = value;
    el.scrollTo({ top: value * WH, behavior: reducedMotion() ? "auto" : "smooth" });
  }, [value, items.length]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const i = paintRef.current();
        if (i !== emitted.current) {
          emitted.current = i;
          cbRef.current(i);
        }
      });
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(raf);
    };
  }, []);

  const goTo = (i: number) => {
    const n = clamp(i, 0, items.length - 1);
    ref.current?.scrollTo({ top: n * WH, behavior: reducedMotion() ? "auto" : "smooth" });
  };

  return (
    <div
      ref={ref}
      className={`st-wheel ${className}`}
      role="listbox"
      tabIndex={0}
      aria-label={label}
      aria-activedescendant={`${uid}-${value}`}
      onKeyDown={(e) => {
        const step = { ArrowDown: 1, ArrowUp: -1, PageDown: 5, PageUp: -5 }[e.key];
        if (step !== undefined) {
          e.preventDefault();
          goTo(value + step);
        } else if (e.key === "Home" || e.key === "End") {
          e.preventDefault();
          goTo(e.key === "Home" ? 0 : items.length - 1);
        }
      }}
    >
      <div className="st-wheel-pad" aria-hidden="true" />
      {items.map((t, i) => (
        <div key={i} id={`${uid}-${i}`} className="st-wi" role="option" aria-selected={i === value} onClick={() => goTo(i)}>
          {t}
        </div>
      ))}
      <div className="st-wheel-pad" aria-hidden="true" />
    </div>
  );
}

/** Reject with an optional reason (kept on the post as its note). */
export function RejectSheet({ open, onClose, onReject }: { open: boolean; onClose: () => void; onReject: (note: string) => Promise<unknown> }) {
  return (
    <Sheet open={open} onClose={onClose} title="Reject this post?">
      <RejectForm onReject={onReject} onDone={onClose} />
    </Sheet>
  );
}

function RejectForm({ onReject, onDone }: { onReject: (note: string) => Promise<unknown>; onDone: () => void }) {
  const id = useId();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  return (
    <form
      className="st-stack"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          await onReject(note);
          onDone();
        } catch (err) {
          setError(err);
        } finally {
          setBusy(false);
        }
      }}
    >
      <p className="st-note">It leaves the queue and is never published. A scheduled post is cancelled.</p>
      <div className="st-field">
        <label className="st-label" htmlFor={id}>
          <span>Reason (optional)</span>
        </label>
        <textarea id={id} className="st-input" rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Duplicate, off-brand, wrong site…" maxLength={500} />
      </div>
      <SheetError error={error} />
      <div className="st-sheet-foot">
        <button type="button" className="st-btn st-btn-ghost" onClick={onDone} disabled={busy}>
          Keep it
        </button>
        <button type="submit" className="st-btn" disabled={busy} data-busy={busy}>
          Reject
        </button>
      </div>
    </form>
  );
}
