"use client";

import Link from "next/link";
import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { formatDate } from "@/lib/storefront";
import { showError } from "./Alerts";
import { shortUrl } from "./format";

type Status = "received" | "preparing" | "listed" | "rejected";

const TABS: { status: Status; label: string; empty: string }[] = [
  { status: "received", label: "Received", empty: "No new submissions. Everything sent from the site's form lands here first." },
  { status: "preparing", label: "Preparing", empty: "Nothing in preparation. Move a submission here while you make its screenshots and copy." },
  {
    status: "listed",
    label: "Listed",
    empty: "Submissions that became listings show here: the ones you made, and the ones creators completed with the full form.",
  },
  { status: "rejected", label: "Rejected", empty: "Nothing rejected." },
];

const FUNNEL: { event: string | string[]; label: string }[] = [
  { event: "submission_page_viewed", label: "Opened /submit" },
  { event: "submission_form_started", label: "Started the form" },
  { event: "submission_form_completed", label: "Pressed submit" },
  { event: ["guest_submission_saved", "account_submission_saved"], label: "Saved (the KPI)" },
  { event: "post_submission_auth_viewed", label: "Saw the sign-in offer" },
  { event: "post_submission_auth_started", label: "Started sign-in" },
  { event: "post_submission_auth_completed", label: "Signed in" },
  { event: "submission_linked_to_account", label: "Linked to an account" },
];

const ASIDES: { event: string; label: string }[] = [
  { event: "guest_submission_saved", label: "Saved as guests" },
  { event: "account_submission_saved", label: "Saved while signed in" },
  { event: "post_submission_auth_skipped", label: "Chose “Maybe later”" },
  { event: "submission_validation_failed", label: "Hit a form error" },
  { event: "post_submission_auth_failed", label: "Sign-in errors" },
  { event: "submission_dashboard_viewed", label: "Viewed their submissions" },
];

function Funnel() {
  const [days, setDays] = useState(7);
  const data = useQuery(api.quickSubmit.funnel, { days });
  const total = (e: string | string[]) => [e].flat().reduce((n, k) => n + (data?.totals[k] ?? 0), 0);
  const top = total("submission_page_viewed") || total("submission_form_started");
  return (
    <section className="admin-panel grid gap-4" aria-labelledby="funnel-heading">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <p id="funnel-heading" className="admin-eyebrow">
          Submission funnel
        </p>
        <div className="flex gap-2">
          {[7, 30].map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDays(d)}
              className={d === days ? "admin-button" : "admin-button admin-button-secondary"}
            >
              {d} days
            </button>
          ))}
        </div>
      </div>
      {!data ? (
        <p className="admin-eyebrow">Loading…</p>
      ) : (
        <>
          <dl className="grid gap-2">
            {FUNNEL.map((f, i) => {
              const n = total(f.event);
              const pct = top ? Math.round((n / top) * 100) : 0;
              return (
                <div key={f.label} className="grid grid-cols-[11rem_minmax(0,1fr)_4.5rem] items-center gap-3">
                  <dt className="text-sm">{f.label}</dt>
                  <dd className="h-2 overflow-hidden rounded-full bg-black/10">
                    <span className="block h-full rounded-full bg-black" style={{ width: `${pct}%` }} />
                  </dd>
                  <dd className="admin-mono text-right text-sm tabular-nums">
                    {n}
                    {i > 0 && top ? <span className="opacity-50"> · {pct}%</span> : null}
                  </dd>
                </div>
              );
            })}
          </dl>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 border-t border-black/10 pt-3 text-sm">
            {ASIDES.map((a) => (
              <div key={a.event} className="flex justify-between gap-2">
                <dt className="opacity-70">{a.label}</dt>
                <dd className="admin-mono tabular-nums">{data.totals[a.event] ?? 0}</dd>
              </div>
            ))}
          </dl>
          {data.savedBySource.length > 0 && (
            <div className="grid gap-1 border-t border-black/10 pt-3">
              <p className="admin-eyebrow">Saved submissions by source</p>
              {data.savedBySource.map((s) => (
                <p key={s.source} className="flex justify-between text-sm">
                  <span>{s.source}</span>
                  <span className="admin-mono tabular-nums">{s.count}</span>
                </p>
              ))}
            </div>
          )}
        </>
      )}
      <p className="text-xs opacity-60">
        Saved is the number that counts: the submission is in, signed in or not. Signing in afterwards is optional and only
        lets them follow it. Counts only, never emails. Source is the utm_source tag, else the in-app browser, else direct.
      </p>
    </section>
  );
}

/** Website submissions from the site's 30-second form, by editorial status, with the funnel. */
export function QuickSubmissions({ status }: { status: Status }) {
  const rows = useQuery(api.quickSubmit.adminList, { status });
  const setStatus = useMutation(api.quickSubmit.setStatus);
  const tab = TABS.find((t) => t.status === status)!;

  const move = async (id: string, next: "received" | "preparing" | "rejected", question?: string) => {
    if (question && !confirm(question)) return;
    try {
      await setStatus({ id: id as Id<"quickSubmissions">, status: next });
    } catch (err) {
      showError(err);
    }
  };

  return (
    <>
      <div className="admin-page-heading">
        <div>
          <p className="admin-eyebrow">Review</p>
          <h1>Submissions.</h1>
          <p>
            Name, link and email from the site&apos;s 30-second form, saved the moment they press submit. Guests never
            signed in, so check the site is real and the email plausibly theirs first. Then make the listing with your own
            screenshots, video and copy, and approve it as usual.
          </p>
          <p>
            A signed-in creator can also fill in the full form themselves. Their submission then moves to Listed here and
            the listing they wrote waits under All listings, as one entry.
          </p>
        </div>
        <nav className="admin-tabs" aria-label="Filter by status">
          {TABS.map((t) => (
            <Link key={t.status} href={`/review/quick?status=${t.status}`} aria-current={t.status === status ? "page" : undefined}>
              {t.label}
            </Link>
          ))}
          <Link href="/review">All listings</Link>
        </nav>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_400px] lg:items-start">
        <section aria-label={tab.label} className="grid gap-3">
          {rows === undefined ? (
            <p className="admin-eyebrow">Loading…</p>
          ) : rows.length === 0 ? (
            <div className="admin-empty">
              <h2>Nothing here.</h2>
              {tab.empty}
            </div>
          ) : (
            rows.map((r) => (
              <article key={r.id} className="admin-panel grid gap-3">
                <div className="flex flex-wrap items-baseline justify-between gap-3">
                  <h2 className="text-xl font-semibold tracking-[-0.02em]">{r.name}</h2>
                  <span className="admin-eyebrow">
                    {formatDate(r.createdAt)} · {r.source}
                    {r.device ? ` · ${r.device}` : ""}
                  </span>
                </div>
                <p className="text-sm">
                  <a href={r.url} target="_blank" rel="noopener noreferrer" className="admin-text-link">
                    {shortUrl(r.url)}
                  </a>
                  <span className="opacity-60"> · {r.email}</span>
                </p>
                <p className="flex flex-wrap items-center gap-2 text-xs">
                  {r.linked ? (
                    <span className="rounded-full border border-black px-2.5 py-1 font-semibold">
                      Account{r.userName ? `: ${r.userName}` : ""} · email verified
                    </span>
                  ) : (
                    <span className="rounded-full border border-dashed border-black/50 px-2.5 py-1 font-semibold">
                      Guest · email not verified
                    </span>
                  )}
                  <span className="opacity-60">{r.agreedToTerms ? "Agreed to the terms" : "Sent before the terms checkbox"}</span>
                  {r.utmCampaign && <span className="opacity-60">campaign {r.utmCampaign}</span>}
                  {r.referrer && <span className="opacity-60">from {r.referrer}</span>}
                </p>
                {!r.linked && (r.status === "received" || r.status === "preparing") && (
                  <p className="text-xs opacity-70">
                    Legitimacy check first: does the site exist, is it a real project, and does the email look like the
                    team&apos;s (same domain, the site&apos;s contact page, a known studio)?
                  </p>
                )}
                {(r.status === "received" || r.status === "preparing") && (
                  <div className="flex flex-wrap gap-3">
                    <Link href={`/listings/new?quick=${r.id}`} className="admin-button">
                      Make listing
                    </Link>
                    {r.status === "received" ? (
                      <button type="button" className="admin-button admin-button-secondary" onClick={() => move(r.id, "preparing")}>
                        Start preparing
                      </button>
                    ) : (
                      <button type="button" className="admin-button admin-button-secondary" onClick={() => move(r.id, "received")}>
                        Back to received
                      </button>
                    )}
                    <button
                      type="button"
                      className="admin-button admin-button-secondary"
                      onClick={() => move(r.id, "rejected", `Reject “${r.name}”? It won't be listed. No email is sent.`)}
                    >
                      Reject
                    </button>
                  </div>
                )}
                {r.status === "rejected" && (
                  <div>
                    <button type="button" className="admin-button admin-button-secondary" onClick={() => move(r.id, "received")}>
                      Reopen
                    </button>
                  </div>
                )}
                {r.status === "listed" && r.listingId && (
                  <Link href={`/review/${r.listingId}`} className="admin-text-link text-sm">
                    Open the listing
                  </Link>
                )}
              </article>
            ))
          )}
        </section>
        <Funnel />
      </div>
    </>
  );
}
