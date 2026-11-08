"use client";

import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { formatDate } from "@/lib/storefront";
import { ClaimLink, EmailClaimLink } from "./ClaimLink";
import { StatusBadge, type ReviewStatus } from "./ReviewQueue";

/** Everything still waiting to be claimed, with its claim link, for DMs and emails. */
export function Outreach() {
  const data = useQuery(api.claimLinks.outreach, {});

  return (
    <>
      <div className="admin-page-heading">
        <div>
          <p className="admin-eyebrow">Outreach</p>
          <h1>Outreach.</h1>
          <p>
            Pre-created jury profiles and listings nobody has claimed yet. Each has a private claim link: send it to
            the person, they sign in and it&apos;s theirs. A link works once. Claiming makes a listing&apos;s links
            followed (dofollow).
          </p>
        </div>
        <Link href="/jury" className="admin-button admin-button-secondary">
          Jury
        </Link>
      </div>

      {data === undefined ? (
        <p className="admin-eyebrow">Loading…</p>
      ) : (
        <div className="grid gap-6">
          <section className="admin-panel" aria-labelledby="outreach-jurors">
            <p id="outreach-jurors" className="admin-eyebrow mb-3">
              Unclaimed jurors ({data.jurors.length})
            </p>
            {data.jurors.length === 0 ? (
              <p className="text-sm text-black/55">
                None. Create profiles on the{" "}
                <Link href="/jury" className="underline underline-offset-4">
                  Jury
                </Link>{" "}
                page.
              </p>
            ) : (
              <ul>
                {data.jurors.map((j) => (
                  <li key={j.id} className="grid gap-3 border-t border-black/10 py-5 first:border-t-0">
                    <div className="grid gap-1">
                      <p className="font-medium">{j.name}</p>
                      <p className="text-sm text-black/70">{j.title}</p>
                      <p className="text-xs text-black/55">
                        {j.email ?? "No email"} · created {formatDate(j.createdAt)}
                      </p>
                      {j.listings.length > 0 && (
                        <p className="text-xs text-black/55">
                          Claimed with it:{" "}
                          {j.listings.map((l, i) => (
                            <span key={l.id}>
                              {i > 0 && ", "}
                              <Link href={`/review/${l.id}`} className="underline underline-offset-4">
                                {l.title}
                              </Link>
                            </span>
                          ))}
                        </p>
                      )}
                    </div>
                    <div className="grid gap-3 md:grid-cols-2">
                      <ClaimLink target={{ kind: "juror", id: j.id }} token={j.claimToken} />
                      <EmailClaimLink jurorId={j.id} email={j.email} name={j.name} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="admin-panel" aria-labelledby="outreach-listings">
            <p id="outreach-listings" className="admin-eyebrow mb-3">
              Unclaimed listings ({data.listings.length})
            </p>
            {data.listings.length === 0 ? (
              <p className="text-sm text-black/55">Every listing has been claimed.</p>
            ) : (
              <ul>
                {data.listings.map((l) => (
                  <li
                    key={l.id}
                    className="flex flex-wrap items-start justify-between gap-4 border-t border-black/10 py-5 first:border-t-0"
                  >
                    <div className="grid min-w-0 gap-2">
                      <p className="flex flex-wrap items-center gap-3 font-medium">
                        <Link href={`/review/${l.id}`} className="underline-offset-4 hover:underline">
                          {l.title}
                        </Link>
                        <StatusBadge status={l.status as ReviewStatus} />
                        {l.isStartup && <span className="admin-tag">Startup</span>}
                      </p>
                      <p className="text-xs text-black/55">
                        {l.juror ? `Bundled with ${l.juror}: their juror link claims it too.` : "On its own."} Added{" "}
                        {formatDate(l.createdAt)}.
                      </p>
                    </div>
                    <ClaimLink target={{ kind: "listing", id: l.id }} token={l.claimToken} />
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </>
  );
}
