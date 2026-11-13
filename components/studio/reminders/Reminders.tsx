"use client";

import "@/app/studio/screens/reminders.css";
import { useEffect, useId, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { showAlert, showError } from "@/components/admin/Alerts";
import { deviceTimeNote, formatTbilisi, parseTbilisiInput, quickTimes, relativeTime, suggestedTime, toTbilisiInput } from "@/lib/studio/time";
import { useNow } from "../hooks";
import { BellIcon, ChevronRightIcon, ClockIcon } from "../icons";
import { PushSwitch } from "../PushSwitch";
import { useStudioPush } from "../StudioShell";
import { TimeSheet } from "../TimeSheet";
import { PageHead, Skel } from "../ui";
import { SwipeRow } from "./SwipeRow";

// Reminders: a line and a Tbilisi time; at that time it arrives as a push
// on this admin's devices (convex/reminders.ts). Upcoming ones are listed
// and can be deleted (which cancels them): swipe a row left, or its button.

const TEXT_MAX = 200;

/** "Today 18:30" → ["Today", "18:30"]. */
function dayAndTime(at: number, now: number) {
  const [day, time] = formatTbilisi(at, now).split(/ (?=\d\d:\d\d$)/);
  return { day, time };
}

export function Reminders({ autoFocus }: { autoFocus: boolean }) {
  const now = useNow(30_000);
  const reminders = useQuery(api.reminders.list, {});
  const push = useStudioPush();
  const remove = useMutation(api.reminders.remove).withOptimisticUpdate((store, { id }) => {
    const list = store.getQuery(api.reminders.list, {});
    if (list) store.setQuery(api.reminders.list, {}, list.filter((r) => r.id !== id));
  });

  return (
    <>
      <PageHead index="05" section="Reminders" title="Remind me." lede="A line and a time (Tbilisi). It arrives as a notification on your devices." />
      <div className="st-split">
        <section className="st-panel st-reminders-new st-in" aria-label="New reminder">
          <NewReminder autoFocus={autoFocus} now={now} />
          {push && push.state !== "on" && (
            <div className="st-callout" data-tone="ok">
              <div className="st-stack" style={{ flex: 1, gap: 8 }}>
                <span>Notifications are off on this device, so reminders won&apos;t show here.</span>
                <PushSwitch withTest={false} />
              </div>
            </div>
          )}
        </section>
        <section className="st-reminders-upcoming" aria-labelledby="reminders-upcoming">
          <div className="st-reminders-head">
            <p id="reminders-upcoming" className="st-eyebrow">
              Upcoming{reminders && reminders.length > 0 ? ` · ${reminders.length}` : ""}
            </p>
            {reminders && reminders.length > 0 && <p className="st-note st-reminders-hint">Swipe left to delete.</p>}
          </div>
          {reminders === undefined ? (
            <div className="st-panel st-reminders-list" aria-hidden="true">
              {[0, 1, 2].map((i) => (
                <div key={i} className="st-reminders-skel">
                  <Skel style={{ width: 64, height: 36, borderRadius: 10 }} />
                  <span className="st-stack" style={{ flex: 1, gap: 8 }}>
                    <Skel className="st-skel-text" style={{ width: "72%" }} />
                    <Skel className="st-skel-text" style={{ width: "36%", height: 11 }} />
                  </span>
                </div>
              ))}
            </div>
          ) : reminders.length === 0 ? (
            <div className="st-empty st-reminders-empty st-in">
              <span className="st-reminders-empty-icon" aria-hidden="true">
                <BellIcon size={24} />
              </span>
              <strong>Nothing coming up.</strong>
              Reminders you add show here until they fire.
            </div>
          ) : (
            <ul className="st-panel st-reminders-list">
              {reminders.map((r, i) => {
                const { day, time } = dayAndTime(r.at, now);
                return (
                  <SwipeRow
                    key={r.id}
                    className="st-in"
                    style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }}
                    label={`Delete “${r.text}”`}
                    onDelete={() =>
                      remove({ id: r.id }).catch((err: unknown) => {
                        showError(err);
                        throw err;
                      })
                    }
                  >
                    <span className="st-reminder-time">
                      <b>{time}</b>
                      <span>{day}</span>
                    </span>
                    <span className="st-reminder-text">
                      {r.text}
                      <span className="st-list-meta" style={{ display: "block", marginTop: 2 }}>
                        {relativeTime(r.at, now)}
                      </span>
                    </span>
                  </SwipeRow>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}

function NewReminder({ autoFocus, now }: { autoFocus: boolean; now: number }) {
  const create = useMutation(api.reminders.create);
  const ids = { text: useId(), at: useId() };
  const textRef = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState("");
  const [when, setWhen] = useState(() => toTbilisiInput(suggestedTime()));
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const at = parseTbilisiInput(when);
  const past = at !== null && at < now - 60_000;
  const device = at !== null ? deviceTimeNote(at) : null;
  const shown = at !== null ? dayAndTime(at, now) : null;

  useEffect(() => {
    if (autoFocus) textRef.current?.focus();
  }, [autoFocus]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim() || at === null || past) return;
    setBusy(true);
    try {
      const r = await create({ text: text.trim(), at });
      showAlert(`Reminder set for ${formatTbilisi(r.at)}.`, "success");
      setText("");
      setWhen(toTbilisiInput(suggestedTime()));
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <form className="st-stack st-reminders-form" onSubmit={submit}>
        <div className="st-field">
          <label className="st-label" htmlFor={ids.text}>
            <span>Remind me to</span>
            <span className="st-counter" data-state={text.length > TEXT_MAX ? "over" : undefined}>
              {text.length} / {TEXT_MAX}
            </span>
          </label>
          <textarea
            ref={textRef}
            id={ids.text}
            className="st-input"
            rows={2}
            style={{ minHeight: 76 }}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Post the SOTD story, reply to the jury…"
            enterKeyHint="done"
          />
        </div>
        <div className="st-field">
          <span className="st-label" id={`${ids.at}-l`}>
            <span>When (Tbilisi time)</span>
          </span>
          <div className="st-row" role="group" aria-labelledby={`${ids.at}-l`}>
            {quickTimes(now).map((q) => (
              <button key={q.label} type="button" className="st-chip st-chip-sm" aria-pressed={when === toTbilisiInput(q.at)} onClick={() => setWhen(toTbilisiInput(q.at))}>
                {q.label}
              </button>
            ))}
          </div>
          <button
            id={ids.at}
            type="button"
            className="lq st-reminders-when"
            aria-haspopup="dialog"
            aria-labelledby={`${ids.at}-l ${ids.at}`}
            data-past={past || undefined}
            onClick={() => setPicking(true)}
          >
            <ClockIcon size={20} />
            <span className="st-reminders-when-text st-tnum">
              {shown ? (
                <>
                  <b>{shown.time}</b> <span>{shown.day}</span>
                </>
              ) : (
                <span>Pick a date and time</span>
              )}
            </span>
            <ChevronRightIcon size={18} />
          </button>
        </div>
        <p className="st-note st-tnum" aria-live="polite" data-past={past || undefined}>
          {at === null ? "Pick a date and time." : past ? "That time has passed." : `${formatTbilisi(at, now)} · ${relativeTime(at, now)}${device ? ` · ${device}` : ""}`}
        </p>
        <button type="submit" className="st-btn st-btn-block" disabled={busy || !text.trim() || text.length > TEXT_MAX || at === null || past} data-busy={busy}>
          Add reminder
        </button>
      </form>
      {/* Outside the form: the sheet has its own form, and forms can't nest. */}
      <TimeSheet
        open={picking}
        onClose={() => setPicking(false)}
        title="Remind me at"
        confirmLabel="Set time"
        initial={at}
        onPick={(picked) => setWhen(toTbilisiInput(picked))}
      />
    </>
  );
}
