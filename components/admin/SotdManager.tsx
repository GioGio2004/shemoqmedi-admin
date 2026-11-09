"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { STOREFRONT_URL, formatDay, storefrontSiteUrl } from "@/lib/storefront";
import { showAlert, showError } from "./Alerts";

type Schedule = FunctionReturnType<typeof api.sotd.schedule>;
type Entry = Schedule["candidates"][number];
type Day = Schedule["days"][number];

function Thumb({ src }: { src: string | null }) {
  return src ? (
    <img src={src} alt="" className="aspect-video w-24 shrink-0 rounded-lg border border-black/10 object-cover object-top" />
  ) : (
    <span className="aspect-video w-24 shrink-0 rounded-lg border border-dashed border-black/20" />
  );
}

function Site({ listing }: { listing: Entry }) {
  return (
    <div className="min-w-0 flex-1">
      <a
        href={storefrontSiteUrl(listing.slug)}
        target="_blank"
        rel="noopener noreferrer"
        className="block truncate text-sm font-semibold hover:underline"
      >
        {listing.title}
      </a>
      <p className="truncate text-xs text-black/55">
        {listing.creditName}
        {listing.finalScore !== null && <span className="admin-mono"> · {listing.finalScore.toFixed(2)}</span>}
      </p>
    </div>
  );
}

/** Whole days from `from` to `to` (both "YYYY-MM-DD"). */
function daysBetween(from: string, to: string) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

function when(day: string, today: string) {
  const d = daysBetween(today, day);
  if (d === 0) return "Today";
  if (d === 1) return "Tomorrow";
  if (d === -1) return "Yesterday";
  return d > 0 ? `In ${d} days` : `${-d} days ago`;
}

/**
 * Site of the Day: one site a day (UTC), never the same one twice. Sites that
 * close voting at 8.50+ queue here on their own; an admin can move them,
 * take them off, or pick any closed site by hand.
 */
export function SotdManager() {
  const data = useQuery(api.sotd.schedule, {});
  const setDay = useMutation(api.sotd.setDay);
  const unschedule = useMutation(api.sotd.unschedule);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");
  const [picks, setPicks] = useState<Record<string, string>>({});

  async function run(action: () => Promise<unknown>, done: string) {
    if (busy) return;
    setBusy(true);
    try {
      await action();
      showAlert(done, "success");
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  }

  if (data === undefined) {
    return <p className="admin-eyebrow">Loading…</p>;
  }

  const { today, nextFree } = data;
  const upcoming = data.days.filter((d) => d.day > today);
  const current = data.days.find((d) => d.day === today) ?? null;
  const past = data.days.filter((d) => d.day < today);
  const tomorrowFree = !upcoming.some((d) => daysBetween(today, d.day) === 1);
  const q = search.trim().toLowerCase();
  const candidates = data.candidates.filter(
    (c) => !q || `${c.title} ${c.creditName} ${c.slug}`.toLowerCase().includes(q),
  );

  const move = (d: Day, day: string) =>
    run(() => setDay({ id: d.listing.id, day }), `“${d.listing.title}” moved to ${formatDay(day)}.`);

  return (
    <>
      <div className="admin-page-heading">
        <div>
          <p className="admin-eyebrow">Awards</p>
          <h1>Site of the Day.</h1>
          <p>
            One site a day, never the same one twice. Sites that close voting at 8.50 or more queue here on their own
            and go public at 00:00 UTC on their day. Move them, take them off, or pick a closed site by hand.
          </p>
        </div>
        <a
          href={`${STOREFRONT_URL}/site-of-the-day`}
          target="_blank"
          rel="noopener noreferrer"
          className="admin-button admin-button-secondary"
        >
          View the archive
        </a>
      </div>

      <div className="grid gap-8 lg:grid-cols-2 lg:items-start">
        <div className="grid gap-8">
          <section className="admin-panel grid gap-4" aria-labelledby="today-title">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <h2 id="today-title" className="text-2xl font-semibold">
                Today
              </h2>
              <p className="admin-mono text-sm">{formatDay(today)}</p>
            </div>
            {current ? (
              <div className="flex items-center gap-3 rounded-2xl border border-black/10 p-2 pr-3">
                <Thumb src={current.listing.coverUrl} />
                <Site listing={current.listing} />
                <span className="admin-mono shrink-0 text-xs">{current.published ? "Live" : "Going live"}</span>
              </div>
            ) : (
              <p className="text-sm leading-relaxed text-black/55">
                No Site of the Day today. The home page shows a different featured site each day instead. Pick one
                below to give today a winner.
              </p>
            )}
          </section>

          <section className="admin-panel grid gap-4" aria-labelledby="upcoming-title">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <h2 id="upcoming-title" className="text-2xl font-semibold">
                Coming up
              </h2>
              <p className="admin-mono text-sm">{upcoming.length}</p>
            </div>
            {tomorrowFree && (
              <p className="text-xs font-medium">
                Nothing is scheduled for tomorrow. Unless a site closes voting at 8.50 or more, tomorrow has no winner.
              </p>
            )}
            {upcoming.length === 0 ? (
              <p className="text-sm text-black/55">The queue is empty.</p>
            ) : (
              <ol className="grid gap-2">
                {upcoming.map((d) => (
                  <li key={d.listing.id} className="grid gap-2 rounded-2xl border border-black/10 p-2 pr-3">
                    <div className="flex items-center gap-3">
                      <Thumb src={d.listing.coverUrl} />
                      <Site listing={d.listing} />
                      <div className="shrink-0 text-right">
                        <p className="admin-mono text-xs">{formatDay(d.day)}</p>
                        <p className="text-xs text-black/55">{when(d.day, today)}</p>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 pl-[108px]">
                      <input
                        type="date"
                        className="admin-input admin-mono !min-h-9 w-auto !py-1.5"
                        min={today}
                        value={picks[d.listing.id] ?? d.day}
                        onChange={(e) => setPicks((p) => ({ ...p, [d.listing.id]: e.target.value }))}
                        aria-label={`New date for ${d.listing.title}`}
                      />
                      <button
                        type="button"
                        className="admin-toggle"
                        disabled={busy || !picks[d.listing.id] || picks[d.listing.id] === d.day}
                        onClick={() => void move(d, picks[d.listing.id])}
                      >
                        Move
                      </button>
                      <button
                        type="button"
                        className="admin-toggle"
                        disabled={busy || current !== null}
                        title={current ? "Today already has a winner" : undefined}
                        onClick={() => void move(d, today)}
                      >
                        Make it today
                      </button>
                      <button
                        type="button"
                        className="admin-toggle"
                        disabled={busy}
                        onClick={() => {
                          if (confirm(`Take “${d.listing.title}” off the schedule? It will not be Site of the Day.`)) {
                            void run(
                              () => unschedule({ id: d.listing.id }),
                              `“${d.listing.title}” is off the schedule.`,
                            );
                          }
                        }}
                      >
                        Remove
                      </button>
                    </div>
                  </li>
                ))}
              </ol>
            )}
            <p className="text-xs text-black/55">
              Moving a site onto a day that another scheduled site has swaps the two.
            </p>
          </section>

          <section className="admin-panel grid gap-4" aria-labelledby="past-title">
            <h2 id="past-title" className="text-2xl font-semibold">
              Past winners
            </h2>
            {past.length === 0 ? (
              <p className="text-sm text-black/55">None yet.</p>
            ) : (
              <ol className="grid gap-2">
                {past.map((d) => (
                  <li key={d.listing.id} className="flex items-center gap-3 rounded-2xl border border-black/10 p-2 pr-3">
                    <Thumb src={d.listing.coverUrl} />
                    <Site listing={d.listing} />
                    <p className="admin-mono shrink-0 text-xs">{formatDay(d.day)}</p>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>

        <section className="admin-panel grid gap-5" aria-labelledby="pick-title">
          <div>
            <h2 id="pick-title" className="text-2xl font-semibold">
              Pick a site
            </h2>
            <p className="mt-2 text-xs leading-relaxed text-black/55">
              Closed sites that have never been Site of the Day, best score first. A pick takes the next free day (
              {formatDay(nextFree)}).
            </p>
          </div>
          <input
            type="search"
            className="admin-input"
            placeholder="Search closed sites"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search closed sites"
          />
          {candidates.length === 0 ? (
            <p className="text-sm text-black/55">{q ? "No site matches." : "No closed site is waiting."}</p>
          ) : (
            <ul className="grid gap-2">
              {candidates.map((c) => (
                <li key={c.id} className="flex items-center gap-3 rounded-2xl border border-black/10 p-2 pr-3">
                  <Thumb src={c.coverUrl} />
                  <Site listing={c} />
                  <button
                    type="button"
                    className="admin-toggle shrink-0"
                    disabled={busy || !c.coverUrl}
                    title={c.coverUrl ? undefined : "Add a cover screenshot first"}
                    onClick={() =>
                      void run(
                        () => setDay({ id: c.id as Id<"listings"> }),
                        `“${c.title}” is Site of the Day on ${formatDay(nextFree)}.`,
                      )
                    }
                  >
                    Schedule
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}
