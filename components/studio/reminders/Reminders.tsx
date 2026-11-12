"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { showAlert, showError } from "@/components/admin/Alerts";
import { deviceTimeNote, formatTbilisi, parseTbilisiInput, quickTimes, relativeTime, suggestedTime, toTbilisiInput } from "@/lib/studio/time";
import { useNow } from "../hooks";
import { TrashIcon } from "../icons";
import { PushSwitch } from "../PushSwitch";
import { useStudioPush } from "../StudioShell";
import { PageHead, Skel } from "../ui";

// Reminders: a line and a Tbilisi time; at that time it arrives as a push
// on this admin's devices (convex/reminders.ts). Upcoming ones are listed
// and can be deleted (which cancels them).

const TEXT_MAX = 200;

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
        <section className="st-panel" aria-label="New reminder">
          <NewReminder autoFocus={autoFocus} now={now} />
          {push && push.state !== "on" && (
            <div className="st-callout" data-tone="blue">
              <div className="st-stack" style={{ flex: 1, gap: 8 }}>
                <span>Notifications are off on this device, so reminders won&apos;t show here.</span>
                <PushSwitch withTest={false} />
              </div>
            </div>
          )}
        </section>
        <section aria-labelledby="reminders-upcoming">
          <p id="reminders-upcoming" className="st-eyebrow" style={{ marginBottom: 4 }}>
            Upcoming{reminders && reminders.length > 0 ? ` · ${reminders.length}` : ""}
          </p>
          {reminders === undefined ? (
            <div className="st-stack" style={{ marginTop: 8 }}>
              {[0, 1, 2].map((i) => (
                <Skel key={i} style={{ height: 56 }} />
              ))}
            </div>
          ) : reminders.length === 0 ? (
            <div className="st-empty" style={{ marginTop: 8 }}>
              <strong>Nothing coming up.</strong>
              Reminders you add show here until they fire.
            </div>
          ) : (
            <ul>
              {reminders.map((r) => {
                const [day, time] = formatTbilisi(r.at, now).split(/ (?=\d\d:\d\d$)/);
                return (
                  <li key={r.id} className="st-reminder st-in">
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
                    <button
                      type="button"
                      className="st-icon-btn"
                      aria-label={`Delete “${r.text}”`}
                      onClick={() => remove({ id: r.id }).catch(showError)}
                    >
                      <TrashIcon size={20} />
                    </button>
                  </li>
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
  const [busy, setBusy] = useState(false);
  const at = parseTbilisiInput(when);
  const past = at !== null && at < now - 60_000;
  const device = at !== null ? deviceTimeNote(at) : null;

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
    <form className="st-stack" onSubmit={submit}>
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
      <div className="st-row">
        {quickTimes(now).map((q) => (
          <button key={q.label} type="button" className="st-chip st-chip-sm" aria-pressed={when === toTbilisiInput(q.at)} onClick={() => setWhen(toTbilisiInput(q.at))}>
            {q.label}
          </button>
        ))}
      </div>
      <div className="st-field">
        <label className="st-label" htmlFor={ids.at}>
          <span>Tbilisi time</span>
        </label>
        <input id={ids.at} className="st-input st-tnum" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} required />
      </div>
      <p className="st-note st-tnum" aria-live="polite">
        {at === null ? "Pick a date and time." : past ? "That time has passed." : `${formatTbilisi(at, now)} · ${relativeTime(at, now)}${device ? ` · ${device}` : ""}`}
      </p>
      <button type="submit" className="st-btn st-btn-blue" disabled={busy || !text.trim() || text.length > TEXT_MAX || at === null || past} data-busy={busy}>
        Add reminder
      </button>
    </form>
  );
}
