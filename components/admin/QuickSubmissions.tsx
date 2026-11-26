"use client";

import Link from "next/link";
import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { formatDate } from "@/lib/storefront";
import { showError } from "./Alerts";
import { shortUrl } from "./format";

type Status = "confirmed" | "unverified" | "listed" | "dismissed";

const TABS: { status: Status; label: string; empty: string }[] = [
  { status: "confirmed", label: "Confirmed", empty: "No confirmed submissions waiting. Verified ones land here." },
  {
    status: "unverified",
    label: "Unverified",
    empty: "Nobody is stuck at the email code. People who started but didn't verify show here for two days.",
  },
  { status: "listed", label: "Listed", empty: "Submissions you've turned into listings show here." },
  { status: "dismissed", label: "Dismissed", empty: "Nothing dismissed." },
];

const FUNNEL: { event: string; label: string }[] = [
  { event: "form_start", label: "Started the form" },
  { event: "presubmit", label: "Pre-submissions" },
  { event: "verify_start", label: "Code sent / Google" },
  { event: "verify_success", label: "Verified" },
  { event: "finalized", label: "Submitted" },
];

function Funnel() {
  const [days, setDays] = useState(7);
  const data = useQuery(api.quickSubmit.funnel, { days });
  const top = data?.totals.form_start || data?.totals.presubmit || 0;
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
        <dl className="grid gap-2">
          {FUNNEL.map((f) => {
            const n = data.totals[f.event] ?? 0;
            const pct = top ? Math.round((n / top) * 100) : 0;
            return (
              <div key={f.event} className="grid grid-cols-[11rem_minmax(0,1fr)_4.5rem] items-center gap-3">
                <dt className="text-sm">{f.label}</dt>
                <dd className="h-2 overflow-hidden rounded-full bg-black/10">
                  <span className="block h-full rounded-full bg-black" style={{ width: `${pct}%` }} />
                </dd>
                <dd className="admin-mono text-right text-sm tabular-nums">
                  {n}
                  {f.event !== "form_start" && top ? <span className="opacity-50"> · {pct}%</span> : null}
                </dd>
              </div>
            );
          })}
        </dl>
      )}
      <p className="text-xs opacity-60">
        Submitted (verified and confirmed) is the number that counts. The gap between pre-submissions and verified shows
        how many people drop off at the email code.
      </p>
    </section>
  );
}

/** Quick submissions from the site's 30-second form, by status, with the funnel. */
export function QuickSubmissions({ status }: { status: Status }) {
  const rows = useQuery(api.quickSubmit.adminList, { status });
  const dismiss = useMutation(api.quickSubmit.dismiss);
  const tab = TABS.find((t) => t.status === status)!;

  return (
    <>
      <div className="admin-page-heading">
        <div>
          <p className="admin-eyebrow">Review</p>
          <h1>Quick submissions.</h1>
          <p>
            Name, link and email from the site&apos;s 30-second form. Confirmed ones verified their email: make each one a
            listing with your own screenshots. Unverified ones never entered the code and are deleted after two days.
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
                    {formatDate(r.confirmedAt ?? r.createdAt)}
                    {r.source ? ` · ${r.source}` : ""}
                  </span>
                </div>
                <p className="text-sm">
                  <a href={r.url} target="_blank" rel="noopener noreferrer" className="admin-text-link">
                    {shortUrl(r.url)}
                  </a>
                  <span className="opacity-60">
                    {" "}
                    · {r.userName ? `${r.userName}, ` : ""}
                    {r.email}
                  </span>
                </p>
                {r.status === "confirmed" && (
                  <div className="flex flex-wrap gap-3">
                    <Link href={`/listings/new?quick=${r.id}`} className="admin-button">
                      Make listing
                    </Link>
                    <button
                      type="button"
                      className="admin-button admin-button-secondary"
                      onClick={async () => {
                        if (!confirm(`Dismiss “${r.name}”? It won't be listed.`)) return;
                        try {
                          await dismiss({ id: r.id as Id<"quickSubmissions"> });
                        } catch (err) {
                          showError(err);
                        }
                      }}
                    >
                      Dismiss
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
