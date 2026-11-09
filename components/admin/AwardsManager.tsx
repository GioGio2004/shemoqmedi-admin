"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { AWARDS } from "@/convex/lib/taxonomy";
import { STOREFRONT_URL, formatDate, formatDay, storefrontSiteUrl } from "@/lib/storefront";
import { showAlert, showError } from "./Alerts";
import { First100 } from "./First100";
import type { AwardSlug } from "./format";

type Overview = FunctionReturnType<typeof api.awards.overview>;
type Entry = Overview["queue"][number]["listing"];

const TIER_NAME = Object.fromEntries(AWARDS.map((a) => [a.slug, a.name])) as Record<AwardSlug, string>;

function Thumb({ src }: { src: string | null }) {
  return src ? (
    <img src={src} alt="" className="aspect-video w-20 shrink-0 rounded-lg border border-black/10 object-cover object-top" />
  ) : (
    <span className="aspect-video w-20 shrink-0 rounded-lg border border-dashed border-black/20" />
  );
}

function Site({ listing }: { listing: Entry | null }) {
  if (!listing) return <span className="text-sm text-black/55">Deleted site</span>;
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
      <p className="truncate text-xs text-black/55">{listing.creditName}</p>
    </div>
  );
}

const score = (n: number | null) => (n === null ? "—" : n.toFixed(2));

/** Asks for the required reason; null when cancelled or empty. */
function askReason(question: string) {
  const reason = prompt(question)?.trim();
  return reason ? reason : null;
}

/**
 * Awards: the Site of the Day queue, recent awards with revoke, manual
 * awards, the monthly/yearly rounds, settings and the audit log. Every
 * manual change needs a reason and lands in the audit log.
 */
type Tab = "awards" | "first100" | "rounds" | "settings" | "log";

export function AwardsManager({ initialTab = "awards" }: { initialTab?: Tab }) {
  const data = useQuery(api.awards.overview, {});
  const [tab, setTab] = useState<Tab>(initialTab);
  const tally = useQuery(api.awards.first100Tally, {});

  return (
    <>
      <div className="admin-page-heading">
        <div>
          <p className="admin-eyebrow">Awards</p>
          <h1>Awards.</h1>
          <p>
            Honorable Mention, Site of the Day, Site of the Month and Site of the Year. Weekly batches close on Sunday
            night (Tbilisi); the best queued site becomes Site of the Day at the announce time each day. Manual awards
            and revokes need a reason and are logged.
          </p>
        </div>
        <a href={`${STOREFRONT_URL}/site-of-the-day`} target="_blank" rel="noopener noreferrer" className="admin-button admin-button-secondary">
          View the archive
        </a>
      </div>

      <div className="mb-8 flex flex-wrap gap-2">
        {(
          [
            ["awards", "Queue & awards"],
            ["first100", tally ? `First 100 · ${tally.given}/${tally.limit}` : "First 100"],
            ["rounds", "Month & year rounds"],
            ["settings", "Settings"],
            ["log", "Audit log"],
          ] as const
        ).map(([key, label]) => (
          <button key={key} type="button" className="admin-toggle" aria-pressed={tab === key} onClick={() => setTab(key)}>
            {label}
          </button>
        ))}
      </div>

      {data === undefined ? (
        <p className="admin-eyebrow">Loading…</p>
      ) : tab === "awards" ? (
        <QueueAndAwards data={data} />
      ) : tab === "first100" ? (
        <First100 />
      ) : tab === "rounds" ? (
        <Rounds data={data} />
      ) : tab === "settings" ? (
        <Settings data={data} />
      ) : (
        <AuditLog />
      )}
    </>
  );
}

function QueueAndAwards({ data }: { data: Overview }) {
  const revoke = useMutation(api.awards.revoke);
  const removeFromQueue = useMutation(api.awards.removeFromQueue);
  const [busy, setBusy] = useState(false);

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

  const todays = data.recent.find((a) => a.tier === "SOTD" && a.period === data.today && a.status === "active");

  return (
    <div className="grid gap-8 lg:grid-cols-2 lg:items-start">
      <div className="grid gap-8">
        <section className="admin-panel grid gap-4" aria-labelledby="today-title">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 id="today-title" className="text-2xl font-semibold">
              Site of the Day today
            </h2>
            <p className="admin-mono text-sm">{formatDay(data.today)}</p>
          </div>
          {todays ? (
            <div className="flex items-center gap-3 rounded-2xl border border-black/10 p-2 pr-3">
              <Thumb src={todays.listing?.coverUrl ?? null} />
              <Site listing={todays.listing} />
              <span className="admin-mono shrink-0 text-xs">{score(todays.score)}</span>
            </div>
          ) : (
            <p className="text-sm leading-relaxed text-black/55">
              No Site of the Day yet today. It is announced at {data.config.announceTime} (Tbilisi) from the queue; with
              an empty queue the day stays empty and admins get an email. Give one by hand below if you need to.
            </p>
          )}
        </section>

        <section className="admin-panel grid gap-4" aria-labelledby="queue-title">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 id="queue-title" className="text-2xl font-semibold">
              Queue
            </h2>
            <p className="admin-mono text-sm">{data.queue.filter((q) => !q.blocked).length}</p>
          </div>
          <p className="text-xs leading-relaxed text-black/55">
            Eligible sites that closed at {data.config.sotdMin.toFixed(2)} or more, best first (ties: more jury votes,
            higher Design, earlier submission). Leftovers carry over to the next weeks. Dates are projections.
          </p>
          {data.queue.length === 0 ? (
            <p className="text-sm text-black/55">The queue is empty.</p>
          ) : (
            <ol className="grid gap-2">
              {data.queue.map((q) => (
                <li key={q.listing.id} className="flex items-center gap-3 rounded-2xl border border-black/10 p-2 pr-3">
                  <Thumb src={q.listing.coverUrl} />
                  <Site listing={q.listing} />
                  <div className="shrink-0 text-right">
                    <p className="admin-mono text-xs">
                      {score(q.score)} · {q.votes} votes
                    </p>
                    <p className="text-xs text-black/55">{q.blocked ?? (q.projectedDay ? formatDay(q.projectedDay) : "")}</p>
                  </div>
                  <button
                    type="button"
                    className="admin-toggle shrink-0"
                    disabled={busy}
                    onClick={() => {
                      const reason = askReason(`Why take “${q.listing.title}” out of the Site of the Day queue? (logged)`);
                      if (reason) void run(() => removeFromQueue({ listingId: q.listing.id, reason }), "Taken out of the queue.");
                    }}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ol>
          )}
        </section>

        <GrantForm />
      </div>

      <section className="admin-panel grid gap-4" aria-labelledby="recent-title">
        <h2 id="recent-title" className="text-2xl font-semibold">
          Recent awards
        </h2>
        {data.recent.length === 0 ? (
          <p className="text-sm text-black/55">No awards yet.</p>
        ) : (
          <ul className="grid gap-2">
            {data.recent.map((a) => (
              <li
                key={a.id}
                className={`grid gap-2 rounded-2xl border border-black/10 p-2 pr-3 ${a.status === "revoked" ? "opacity-55" : ""}`}
              >
                <div className="flex items-center gap-3">
                  <Thumb src={a.listing?.coverUrl ?? null} />
                  <Site listing={a.listing} />
                  <div className="shrink-0 text-right">
                    <p className="text-xs font-semibold">{TIER_NAME[a.tier]}</p>
                    <p className="admin-mono text-xs text-black/55">
                      {a.period} · {score(a.score)}
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 pl-[92px] text-xs text-black/55">
                  <span>
                    {a.status === "revoked"
                      ? `Revoked: ${a.revokeReason}`
                      : a.source === "manual"
                        ? `By hand: ${a.reason}`
                        : `Announced ${formatDay(a.date)}`}
                  </span>
                  {a.status === "active" && (
                    <span className="flex gap-3">
                      <a href={`${STOREFRONT_URL}/awards/${a.slug}`} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4">
                        Award page
                      </a>
                      <button
                        type="button"
                        className="underline underline-offset-4"
                        disabled={busy}
                        onClick={() => {
                          const reason = askReason(`Why revoke ${TIER_NAME[a.tier]} (${a.period}) from “${a.listing?.title}”? (logged)`);
                          if (reason) void run(() => revoke({ awardId: a.id, reason }), "Award revoked.");
                        }}
                      >
                        Revoke
                      </button>
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function defaultPeriod(tier: AwardSlug, today: string) {
  return tier === "SOTM" ? today.slice(0, 7) : tier === "SOTY" ? today.slice(0, 4) : today;
}

/** Manual award: any closed public site, any tier, with a reason. */
function GrantForm() {
  const options = useQuery(api.admin.featuredOptions, {});
  const grant = useMutation(api.awards.grant);
  // Today in Tbilisi (UTC+4), read once.
  const [today] = useState(() => new Date(Date.now() + 4 * 3_600_000).toISOString().slice(0, 10));
  const [search, setSearch] = useState("");
  const [listingId, setListingId] = useState<Id<"listings"> | "">("");
  const [tier, setTier] = useState<AwardSlug>("SOTD");
  const [period, setPeriod] = useState(today);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const q = search.trim().toLowerCase();
  const closed = useMemo(
    () =>
      (options ?? []).filter(
        (o) => o.status !== "in_voting" && (!q || `${o.title} ${o.creditName} ${o.slug}`.toLowerCase().includes(q)),
      ),
    [options, q],
  );

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!listingId || !reason.trim() || busy) return;
    setBusy(true);
    try {
      await grant({ listingId, tier, period: period.trim() || undefined, reason: reason.trim() });
      showAlert(`${TIER_NAME[tier]} given.`, "success");
      setReason("");
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="admin-panel grid gap-4" aria-labelledby="grant-title">
      <h2 id="grant-title" className="text-2xl font-semibold">
        Give an award by hand
      </h2>
      <p className="text-xs leading-relaxed text-black/55">
        An override: the usual rules still hold (one Site of the Day per day, one SOTM per month, one SOTY per year, a
        site wins each once, never a team site). Revoke first to replace a winner.
      </p>
      <form onSubmit={onSubmit} className="grid gap-3">
        <input
          type="search"
          className="admin-input"
          placeholder="Search closed sites"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search closed sites"
        />
        <select className="admin-input" value={listingId} onChange={(e) => setListingId(e.target.value as Id<"listings">)} aria-label="Site">
          <option value="">Choose a site…</option>
          {closed.slice(0, 100).map((o) => (
            <option key={o.id} value={o.id}>
              {o.title} · {o.creditName}
            </option>
          ))}
        </select>
        <div className="grid gap-3 sm:grid-cols-2">
          <select
            className="admin-input"
            value={tier}
            onChange={(e) => {
              const next = e.target.value as AwardSlug;
              setTier(next);
              setPeriod(defaultPeriod(next, today));
            }}
            aria-label="Award"
          >
            {AWARDS.filter((a) => a.slug !== "F100").map((a) => (
              <option key={a.slug} value={a.slug}>
                {a.name}
              </option>
            ))}
          </select>
          <input
            className="admin-input admin-mono"
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
            aria-label="For (day, month or year)"
            placeholder={tier === "SOTM" ? "2026-11" : tier === "SOTY" ? "2026" : "2026-11-12"}
          />
        </div>
        <input className="admin-input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (required, logged)" />
        <button type="submit" className="admin-button" disabled={busy || !listingId || !reason.trim()}>
          {busy ? "Giving…" : "Give award"}
        </button>
      </form>
    </section>
  );
}

function Rounds({ data }: { data: Overview }) {
  if (data.rounds.length === 0) {
    return (
      <p className="text-sm text-black/55">
        No rounds yet. Site of the Month opens on the 1st for last month&apos;s Site of the Day winners; Site of the Year
        opens on 1 January.
      </p>
    );
  }
  return (
    <div className="grid gap-6">
      {data.rounds.map((r) => (
        <section key={r.id} className="admin-panel grid gap-4">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 className="text-2xl font-semibold">
              {r.kind === "SOTM" ? "Site of the Month" : "Site of the Year"} · {r.period}
            </h2>
            <p className="admin-mono text-xs">
              {r.status === "open"
                ? `Votes until ${formatDate(r.closesAt)} · announced ${formatDate(r.announceAt)}`
                : r.winner
                  ? `Winner: ${r.winner.title}`
                  : "No winner"}
            </p>
          </div>
          {r.results.length === 0 ? (
            <p className="text-sm text-black/55">No candidates.</p>
          ) : (
            <ol className="grid gap-2">
              {r.results.map((x, i) => (
                <li key={x.listing.id} className="flex items-center gap-3 rounded-2xl border border-black/10 p-2 pr-3">
                  <span className="admin-mono w-6 text-center text-sm">{i + 1}</span>
                  <Thumb src={x.listing.coverUrl} />
                  <Site listing={x.listing} />
                  <div className="shrink-0 text-right">
                    <p className="admin-mono text-xs">
                      {score(x.score)} · {x.votes} votes
                    </p>
                    {x.blocked && <p className="text-xs text-black/55">{x.blocked}</p>}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </section>
      ))}
    </div>
  );
}

const SETTINGS: { key: string; label: string; hint: string; kind: "number" | "text"; step?: string }[] = [
  { key: "minVotes", label: "Minimum jury votes", hint: "Votes a site needs for any award. Raise it as the jury grows.", kind: "number", step: "1" },
  { key: "honorableMentionMin", label: "Honorable Mention from", hint: "Final score.", kind: "number", step: "0.01" },
  { key: "sotdMin", label: "Site of the Day queue from", hint: "Final score.", kind: "number", step: "0.01" },
  { key: "bscMin", label: "Best Solo Creation from", hint: "Solo makers only. Side award.", kind: "number", step: "0.01" },
  { key: "announceTime", label: "Announce time", hint: "Tbilisi, HH:MM. Daily SOTD, SOTM on the 6th, SOTY on its date.", kind: "text" },
  { key: "monthlyRoundDays", label: "Monthly round days", hint: "From the 1st; announced when it closes.", kind: "number", step: "1" },
  { key: "yearlyRoundDays", label: "Yearly round days", hint: "From 1 January.", kind: "number", step: "1" },
  { key: "yearlyAnnounceDate", label: "Site of the Year date", hint: "MM-DD, e.g. 01-20 for an awards event.", kind: "text" },
  { key: "resubmitMonths", label: "Months before a winner returns", hint: "As a significant redesign, admin-approved.", kind: "number", step: "1" },
  { key: "digestTime", label: "Jury digest time", hint: "Tbilisi, HH:MM, daily.", kind: "text" },
];

function Settings({ data }: { data: Overview }) {
  const save = useMutation(api.awards.updateSettings);
  const [draft, setDraft] = useState<Record<string, string>>(() =>
    Object.fromEntries(SETTINGS.map((s) => [s.key, String((data.config as Record<string, unknown>)[s.key])])),
  );
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const args = Object.fromEntries(
        SETTINGS.map((s) => [s.key, s.kind === "number" ? Number(draft[s.key]) : draft[s.key].trim()]),
      );
      await save(args);
      showAlert("Settings saved and logged.", "success");
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="admin-panel grid max-w-3xl gap-5">
      <div className="grid gap-4 sm:grid-cols-2">
        {SETTINGS.map((s) => (
          <label key={s.key} className="grid gap-1.5">
            <span className="admin-eyebrow">{s.label}</span>
            <input
              className="admin-input admin-mono"
              type={s.kind}
              step={s.step}
              value={draft[s.key]}
              onChange={(e) => setDraft((d) => ({ ...d, [s.key]: e.target.value }))}
            />
            <span className="text-xs text-black/55">
              {s.hint} Default {String((data.defaults as Record<string, unknown>)[s.key])}.
            </span>
          </label>
        ))}
      </div>
      <button type="submit" className="admin-button justify-self-start" disabled={busy}>
        {busy ? "Saving…" : "Save settings"}
      </button>
    </form>
  );
}

const KIND_LABEL: Record<string, string> = {
  batch_closed: "Voting closed",
  granted: "Awarded",
  revoked: "Revoked",
  empty_day: "No Site of the Day",
  round_opened: "Round opened",
  round_decided: "Round decided",
  team_site: "Team site",
  queue_removed: "Left the queue",
  settings: "Settings changed",
};

function AuditLog() {
  const rows = useQuery(api.awards.auditLog, { limit: 200 });
  if (rows === undefined) return <p className="admin-eyebrow">Loading…</p>;
  if (rows.length === 0) return <p className="text-sm text-black/55">Nothing logged yet.</p>;
  return (
    <ol className="admin-panel grid gap-3">
      {rows.map((r) => (
        <li key={r.id} className="grid gap-1 border-b border-black/8 pb-3 last:border-b-0 last:pb-0">
          <div className="flex flex-wrap items-baseline justify-between gap-3 text-sm">
            <span className="font-semibold">
              {KIND_LABEL[r.kind] ?? r.kind}
              {r.tier ? ` · ${TIER_NAME[r.tier as AwardSlug] ?? r.tier}` : ""}
              {r.period ? ` · ${r.period}` : ""}
            </span>
            <span className="admin-mono text-xs text-black/55">{formatDate(r.createdAt)}</span>
          </div>
          <p className="text-xs text-black/70">
            {r.listing ? `${r.listing.title} · ` : ""}
            {r.actor ? `by ${r.actor}` : "scheduled job"}
            {r.reason ? ` · “${r.reason}”` : ""}
          </p>
          {r.details && (
            <details className="text-xs">
              <summary className="cursor-pointer text-black/55">Inputs</summary>
              <pre className="mt-2 overflow-x-auto rounded-lg bg-black/[0.04] p-3 text-[11px] leading-relaxed">
                {JSON.stringify(r.details, null, 2)}
              </pre>
            </details>
          )}
        </li>
      ))}
    </ol>
  );
}
