"use client";

import { showError } from "./Alerts";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { formatDate, storefrontSiteUrl } from "@/lib/storefront";
import { STATUS_LABEL, StatusBadge } from "./ReviewQueue";
import { ScoreEditor } from "./ScoreEditor";
import { ListingEditForm } from "./ListingEditForm";
import { MediaPanel } from "./MediaPanel";
import { LifecyclePanel } from "./LifecyclePanel";
import { SOURCE_LABEL, safeHref, storefrontCreatorUrl } from "./format";

/** Full control panel for one listing: details, media, lifecycle, scores. */
export function ReviewDetail({ id }: { id: Id<"listings"> }) {
  const router = useRouter();
  const listing = useQuery(api.listings.reviewDetail, { id });
  const remove = useMutation(api.listings.remove);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  if (listing === undefined) return <p className="admin-eyebrow">Loading…</p>;
  // After a delete the query turns null before router.push lands: don't flash "Not found".
  if (listing === null && deleting) return <p className="admin-eyebrow">Deleted. Returning to review…</p>;
  if (listing === null) {
    return (
      <div className="admin-empty">
        <h2>Not found.</h2>
        This listing no longer exists.{" "}
        <Link href="/review" className="admin-text-link">
          Back to review
        </Link>
      </div>
    );
  }

  const status = listing.status;
  const isPublic = status === "in_voting" || status === "awarded" || status === "archived";
  const creditHref = safeHref(listing.creditUrl);
  const liveHref = safeHref(listing.url);

  async function onDelete() {
    if (deleting || !listing) return;
    if (!confirm(`Delete "${listing.title}" with its votes and media? This can't be undone.`)) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await remove({ id });
      router.push("/review");
    } catch (err) {
      showError(err);
      setDeleting(false);
    }
  }

  return (
    <>
      <div className="admin-page-heading">
        <div>
          <Link href={`/review?status=${status}`} className="admin-text-link">
            ← Back to {STATUS_LABEL[status].toLowerCase()}
          </Link>
          <p className="admin-eyebrow mt-6">{listing.categoryName}</p>
          <h1>{listing.title}</h1>
          {listing.tagline && <p>{listing.tagline}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <StatusBadge status={status} />
          {liveHref && (
            <a href={liveHref} target="_blank" rel="noopener noreferrer" className="admin-button admin-button-secondary">
              Open live site <span aria-hidden="true">↗</span>
            </a>
          )}
          {isPublic && (
            <a
              href={storefrontSiteUrl(listing.slug)}
              target="_blank"
              rel="noopener noreferrer"
              className="admin-button admin-button-secondary"
            >
              View on the site <span aria-hidden="true">↗</span>
            </a>
          )}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_400px]">
        <div className="grid min-w-0 content-start gap-6">
          {listing.coverUrl && (
            <section aria-label="Screenshot preview">
              <a
                href={listing.coverUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="request-thumb block rounded-[24px]"
              >
                <img src={listing.coverUrl} alt={`${listing.title} desktop screenshot`} />
              </a>
            </section>
          )}

          <ListingEditForm key={listing.id} listing={listing} />
          <MediaPanel key={`media-${listing.id}`} listing={listing} />
        </div>

        <aside className="grid min-w-0 content-start gap-6 lg:sticky lg:top-[132px] lg:max-h-[calc(100dvh-156px)] lg:self-start lg:overflow-y-auto lg:overscroll-contain">
          <LifecyclePanel
            key={[listing.id, status, listing.votingEndsAt, listing.awards.join(","), listing.reviewNote].join("|")}
            listing={listing}
          />

          <ScoreEditor
            key={listing.id}
            id={listing.id}
            editorialScores={listing.editorialScores}
            editorialAverage={listing.editorialAverage}
            communityAverage={listing.communityAverage}
            communityVotesCount={listing.communityVotesCount}
            finalScore={listing.finalScore}
            awards={listing.awards}
          />

          <section className="admin-panel" aria-labelledby="facts-heading">
            <p id="facts-heading" className="admin-eyebrow mb-5">
              Facts
            </p>
            <dl className="request-fields">
              <div className="wide">
                <dt>Live URL</dt>
                <dd>
                  {liveHref ? (
                    <a href={liveHref} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4">
                      {listing.url}
                    </a>
                  ) : (
                    listing.url
                  )}
                </dd>
              </div>
              <div className="wide">
                <dt>Page on the site</dt>
                <dd className="admin-mono normal-case">/sites/{listing.slug}</dd>
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
                <dt>Source</dt>
                <dd>{SOURCE_LABEL[listing.source]}</dd>
              </div>
              <div>
                <dt>Added</dt>
                <dd>{formatDate(listing.createdAt)}</dd>
              </div>
              <div className="wide">
                <dt>Submitted by</dt>
                <dd>
                  {listing.submitter
                    ? `${listing.submitter.name} (${listing.submitter.email})`
                    : listing.source === "submission"
                      ? "Unknown"
                      : `${SOURCE_LABEL[listing.source]} (no submitter)`}
                </dd>
              </div>
            </dl>
          </section>

          <section className="admin-panel" aria-labelledby="danger-heading">
            <p id="danger-heading" className="admin-eyebrow mb-3">
              Danger zone
            </p>
            <p className="mb-5 text-xs leading-relaxed text-black/55">
              Deletes the listing, its votes, its screenshots and its video for good.
            </p>
            {deleteError && (
              <p role="alert" className="mb-4 text-sm font-medium">
                {deleteError}
              </p>
            )}
            <button
              type="button"
              className="admin-button admin-button-secondary w-full"
              disabled={deleting}
              onClick={onDelete}
            >
              {deleting ? "Deleting…" : "Delete listing permanently"}
            </button>
          </section>
        </aside>
      </div>
    </>
  );
}
