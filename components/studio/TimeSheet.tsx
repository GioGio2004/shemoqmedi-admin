"use client";

import { useId, useState } from "react";
import { deviceTimeNote, formatTbilisi, parseTbilisiInput, quickTimes, relativeTime, suggestedTime, toTbilisiInput } from "@/lib/studio/time";
import { useNow } from "./hooks";
import { Sheet } from "./ui";

/**
 * Pick a moment in Tbilisi time (schedule a post, or a reminder's time):
 * one-tap suggestions, or a date-time field. `onPick` may be async; the sheet
 * waits and closes when it resolves.
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
    <Sheet open={open} onClose={onClose} title={title}>
      <TimeForm initial={initial} confirmLabel={confirmLabel} onPick={onPick} onDone={onClose} intro={intro} />
    </Sheet>
  );
}

function TimeForm({ initial, confirmLabel, onPick, onDone, intro }: { initial?: number | null; confirmLabel: string; onPick: (at: number) => Promise<unknown> | void; onDone: () => void; intro?: React.ReactNode }) {
  const id = useId();
  const now = useNow(10_000);
  const [value, setValue] = useState(() => {
    const start = Date.now();
    return toTbilisiInput(initial && initial > start ? initial : suggestedTime(start));
  });
  const [busy, setBusy] = useState(false);
  const at = parseTbilisiInput(value);
  const past = at !== null && at < now - 60_000;
  const device = at !== null ? deviceTimeNote(at) : null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (at === null || past) return;
    setBusy(true);
    try {
      await onPick(at);
      onDone();
    } catch {
      // The caller showed the error; stay open.
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="st-stack" onSubmit={submit}>
      {intro && <div className="st-note">{intro}</div>}
      <div className="st-row">
        {quickTimes(now).map((q) => (
          <button key={q.label} type="button" className="st-chip st-chip-sm" aria-pressed={value === toTbilisiInput(q.at)} onClick={() => setValue(toTbilisiInput(q.at))}>
            {q.label}
          </button>
        ))}
      </div>
      <div className="st-field">
        <label className="st-label" htmlFor={id}>
          <span>Tbilisi time (UTC+4)</span>
        </label>
        <input id={id} className="st-input st-tnum" type="datetime-local" value={value} min={toTbilisiInput(now)} onChange={(e) => setValue(e.target.value)} required />
      </div>
      <p className="st-note st-tnum" aria-live="polite">
        {at === null ? "Pick a date and time." : past ? "That time has passed." : `${formatTbilisi(at, now)} · ${relativeTime(at, now)}${device ? ` · ${device}` : ""}`}
      </p>
      <div className="st-sheet-foot">
        <button type="button" className="st-btn st-btn-ghost" onClick={onDone} disabled={busy}>
          Cancel
        </button>
        <button type="submit" className="st-btn st-btn-blue" disabled={busy || at === null || past} data-busy={busy}>
          {confirmLabel}
        </button>
      </div>
    </form>
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
  return (
    <form
      className="st-stack"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          await onReject(note);
          onDone();
        } catch {
          // Shown by the caller.
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
