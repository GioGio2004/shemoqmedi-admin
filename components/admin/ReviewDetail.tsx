"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { formatDate, storefrontSiteUrl } from "@/lib/storefront";
import { STATUS_LABEL, StatusBadge } from "./ReviewQueue";
import { ScoreEditor } from "./ScoreEditor";
import {
  SOURCE_LABEL,
  errorMessage,
  regionLabel,
  safeHref,
  storefrontCreatorUrl,
  tierLabel,
} from "./format";

export function ReviewDetail({ id }: { id: Id<"listings"> }) {
  const router = useRouter();
  const listing = useQuery(api.listings.reviewDetail, { id });
  const approve = useMutation(api.listings.approve);
  const reject = useMutation(api.listings.reject);
  const closeVoting = useMutation(api.listings.closeVotingNow);
  const remove = useMutation(api.listings.remove);

  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<unknown>, after?: () => void) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await action();
      after?.();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (listing === undefined) return <p className="admin-eyebrow">Loading…</p>;
  if (listing === null) {
    return (
      <div className="admin-empty">
        <h2>Not found.</h2>
        This listing no longer exists.{" "}
        <Link href="/review" className="admin-text-link">Back to review</Link>
      </div>
    );
  }

  const status = listing.status;
  const isPublic = status === "in_voting" || status === "awarded" || status === "archived";
  const canApprove = status === "pending" || status === "rejected";
  const canReject = status === "pending" || status === "in_voting";
  const scoresLocked = status === "awarded" || status === "archived";
  const creditHref = safeHref(listing.creditUrl);

  return (
    <>
      <div className="admin-page-heading">
        <div>
          <Link href={`/review?status=${status}`} className="admin-text-link">
            ← Back to {STATUS_LABEL[status].toLowerCase()}
          </Link>
          <p className="admin-eyebrow mt-6">{listing.categoryName}</p>
          <h1>{listing.title}</h1>
          <p>{listing.tagline}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <StatusBadge status={status} />
          <a href={listing.url} target="_blank" rel="noopener noreferrer" className="admin-button admin-button-secondary">
            Open live site <span aria-hidden="true">↗</span>
          </a>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <section aria-label="Media" className="grid content-start gap-6">
          {listing.coverUrl && (
            <a href={listing.coverUrl} target="_blank" rel="noopener noreferrer" className="request-thumb block rounded-[24px]">
              <img src={listing.coverUrl} alt={`${listing.title} desktop screenshot`} />
            </a>
          )}
          {listing.videoUrl && (
            <div className="request-thumb rounded-[24px]">
              <video
                src={listing.videoUrl}
                className="absolute inset-0 h-full w-full object-cover object-top"
                muted
                loop
                playsInline
                controls
                aria-label={`${listing.title} preview video`}
              />
            </div>
          )}
          {listing.mobileUrl && (
            <a
              href={listing.mobileUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="request-thumb block w-full max-w-[280px] rounded-[24px]"
              style={{ aspectRatio: "9 / 19.5" }}
            >
              <img src={listing.mobileUrl} alt={`${listing.title} mobile screenshot`} />
            </a>
          )}
        </section>

        <aside className="grid content-start gap-6">
          <section className="admin-panel" aria-labelledby="decision-heading">
            <p id="decision-heading" className="admin-eyebrow mb-5">Decision</p>
            {error && <p role="alert" className="mb-4 text-sm font-medium">{error}</p>}
            <div className="grid gap-3">
              {canApprove && (
                <button
                  type="button"
                  className="admin-button w-full"
                  disabled={busy}
                  onClick={() => run(() => approve({ id }))}
                >
                  Approve: start 7-day voting <span aria-hidden="true">↗</span>
                </button>
              )}
              {status === "in_voting" && (
                <button
                  type="button"
                  className="admin-button w-full"
                  disabled={busy}
                  onClick={() => {
                    if (
                      confirm(
                        `Close voting for "${listing.title}" now and assign awards from the current score? This can't be undone.`,
                      )
                    ) {
                      void run(() => closeVoting({ id }));
                    }
                  }}
                >
                  Close voting now &amp; assign awards
                </button>
              )}
              {isPublic && (
                <a
                  href={storefrontSiteUrl(listing.slug)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="admin-button admin-button-secondary w-full"
                >
                  View on the site <span aria-hidden="true">↗</span>
                </a>
              )}

              {canReject && (
                <>
                  <label htmlFor="reject-note" className="admin-eyebrow mt-4">
                    {status === "in_voting" ? "Unpublish with a reason" : "Reject with a reason"}
                  </label>
                  <textarea
                    id="reject-note"
                    rows={3}
                    maxLength={500}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="e.g. The screenshot doesn't match the live site."
                    className="admin-input resize-y"
                  />
                  <button
                    type="button"
                    className="admin-button admin-button-secondary w-full"
                    disabled={busy || !note.trim()}
                    onClick={() => run(() => reject({ id, note }), () => setNote(""))}
                  >
                    {status === "in_voting" ? "Unpublish" : "Reject"}
                  </button>
                </>
              )}
              {status === "rejected" && listing.reviewNote && (
                <p className="text-xs text-black/55">Current reason: {listing.reviewNote}</p>
              )}
              {(status === "awarded" || status === "archived") && (
                <p className="text-xs text-black/55">
                  Voting closed{listing.votingEndsAt ? ` ${formatDate(listing.votingEndsAt)}` : ""}.
                  Results are final.
                </p>
              )}
            </div>
          </section>

          <ScoreEditor
            key={listing.id}
            id={listing.id}
            editorialScores={listing.editorialScores}
            editorialAverage={listing.editorialAverage}
            communityAverage={listing.communityAverage}
            communityVotesCount={listing.communityVotesCount}
            finalScore={listing.finalScore}
            awards={listing.awards}
            locked={scoresLocked}
          />

          <section className="admin-panel" aria-label="Facts">
            <dl className="request-fields">
              <div className="wide">
                <dt>Live URL</dt>
                <dd>
                  <a href={listing.url} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4">
                    {listing.url}
                  </a>
                </dd>
              </div>
              <div className="wide">
                <dt>Made by</dt>
                <dd>
                  {creditHref ? (
                    <a href={creditHref} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4">
                      {listing.creditName}
                    </a>
                  ) : (
                    listing.creditName
                  )}
                  {listing.creator && (
                    <>
                      {" · "}
                      <a
                        href={storefrontCreatorUrl(listing.creator.slug)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline underline-offset-4"
                      >
                        Profile
                      </a>
                      {listing.creator.isClaimed ? " (claimed)" : " (unclaimed)"}
                    </>
                  )}
                </dd>
              </div>
              <div>
                <dt>Creator tier</dt>
                <dd><span className="admin-tag">{tierLabel(listing.creatorTier)}</span></dd>
              </div>
              <div>
                <dt>Region</dt>
                <dd>{regionLabel(listing.region)}</dd>
              </div>
              <div>
                <dt>Category</dt>
                <dd>{listing.categoryName}</dd>
              </div>
              <div>
                <dt>Source</dt>
                <dd>{SOURCE_LABEL[listing.source]}</dd>
              </div>
              <div>
                <dt>Site claimed</dt>
                <dd>{listing.isClaimed ? "Yes" : "No"}</dd>
              </div>
              <div>
                <dt>Submitted by</dt>
                <dd>
                  {listing.submitter
                    ? `${listing.submitter.name} (${listing.submitter.email})`
                    : listing.source === "submission"
                      ? "Unknown"
                      : `${SOURCE_LABEL[listing.source]} (no submitter)`}
                </dd>
              </div>
              {listing.technologies.length > 0 && (
                <div className="wide">
                  <dt>Built with</dt>
                  <dd className="flex flex-wrap gap-2">
                    {listing.technologies.map((t) => (
                      <span key={t} className="admin-tag">{t}</span>
                    ))}
                  </dd>
                </div>
              )}
              <div>
                <dt>Added</dt>
                <dd>{formatDate(listing.createdAt)}</dd>
              </div>
              <div>
                <dt>Reviewed</dt>
                <dd>{listing.reviewedAt ? formatDate(listing.reviewedAt) : "Not yet"}</dd>
              </div>
              {listing.publishedAt && (
                <div>
                  <dt>Voting opened</dt>
                  <dd>{formatDate(listing.publishedAt)}</dd>
                </div>
              )}
              {listing.votingEndsAt && (
                <div>
                  <dt>
                    {status === "in_voting"
                      ? "Voting ends"
                      : status === "rejected"
                        ? "Voting window was set to end"
                        : "Voting ended"}
                  </dt>
                  <dd>{formatDate(listing.votingEndsAt)}</dd>
                </div>
              )}
            </dl>
          </section>

          <button
            type="button"
            className="admin-text-link justify-self-start"
            disabled={busy}
            onClick={() => {
              if (confirm(`Delete "${listing.title}", its votes and its media? This can't be undone.`)) {
                void run(() => remove({ id }), () => router.push(`/review?status=${status}`));
              }
            }}
          >
            Delete listing permanently
          </button>
        </aside>
      </div>
    </>
  );
}
