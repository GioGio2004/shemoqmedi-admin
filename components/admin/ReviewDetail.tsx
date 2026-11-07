"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { formatDate, storefrontSiteUrl } from "@/lib/storefront";
import { StatusBadge } from "./ReviewQueue";

function message(err: unknown) {
  if (err instanceof ConvexError) return String(err.data);
  if (err instanceof Error) return err.message;
  return "Something went wrong.";
}

export function ReviewDetail({ id }: { id: Id<"listings"> }) {
  const router = useRouter();
  const listing = useQuery(api.listings.reviewDetail, { id });
  const approve = useMutation(api.listings.approve);
  const reject = useMutation(api.listings.reject);
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
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  if (listing === undefined) return <p className="admin-eyebrow">Loading…</p>;
  if (listing === null) {
    return (
      <div className="admin-empty">
        <h2>Not found.</h2>
        This submission no longer exists.{" "}
        <Link href="/review" className="admin-text-link">Back to review</Link>
      </div>
    );
  }

  return (
    <>
      <div className="admin-page-heading">
        <div>
          <Link href={`/review?status=${listing.status}`} className="admin-text-link">
            ← Back to {listing.status === "pending" ? "the queue" : "the list"}
          </Link>
          <p className="admin-eyebrow mt-6">{listing.categoryName}</p>
          <h1>{listing.title}</h1>
          <p>{listing.tagline}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <StatusBadge status={listing.status} />
          <a href={listing.url} target="_blank" rel="noopener noreferrer" className="admin-button admin-button-secondary">
            Open live site <span aria-hidden="true">↗</span>
          </a>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <section aria-label="Screenshots" className="grid gap-6">
          {listing.coverUrl && (
            <a href={listing.coverUrl} target="_blank" rel="noopener noreferrer" className="request-thumb block rounded-[24px]">
              <img src={listing.coverUrl} alt={`${listing.title} desktop screenshot`} />
            </a>
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
          <section className="admin-panel">
            <p className="admin-eyebrow mb-5">Decision</p>
            {error && <p role="alert" className="mb-4 text-sm font-medium">{error}</p>}
            <div className="grid gap-3">
              {listing.status !== "approved" && (
                <button
                  type="button"
                  className="admin-button w-full"
                  disabled={busy}
                  onClick={() => run(() => approve({ id }))}
                >
                  Approve and publish <span aria-hidden="true">↗</span>
                </button>
              )}
              {listing.status === "approved" && (
                <a href={storefrontSiteUrl(listing.slug)} target="_blank" rel="noopener noreferrer" className="admin-button w-full">
                  View on the site <span aria-hidden="true">↗</span>
                </a>
              )}

              <label htmlFor="reject-note" className="admin-eyebrow mt-4">
                {listing.status === "approved" ? "Unpublish with a reason" : "Reject with a reason"}
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
                {listing.status === "approved" ? "Unpublish" : "Reject"}
              </button>
              {listing.status === "rejected" && listing.reviewNote && (
                <p className="text-xs text-black/55">Current reason: {listing.reviewNote}</p>
              )}
            </div>
          </section>

          <section className="admin-panel">
            <dl className="request-fields">
              <div className="wide">
                <dt>Live URL</dt>
                <dd>
                  <a href={listing.url} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4">
                    {listing.url}
                  </a>
                </dd>
              </div>
              <div>
                <dt>Made by</dt>
                <dd>
                  {listing.creditUrl ? (
                    <a href={listing.creditUrl} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4">
                      {listing.creditName}
                    </a>
                  ) : (
                    listing.creditName
                  )}
                </dd>
              </div>
              <div>
                <dt>Category</dt>
                <dd>{listing.categoryName}</dd>
              </div>
              <div className="wide">
                <dt>Built with</dt>
                <dd className="flex flex-wrap gap-2">
                  {listing.technologies.map((t) => (
                    <span key={t} className="admin-tag">{t}</span>
                  ))}
                </dd>
              </div>
              <div className="wide">
                <dt>Submitted by</dt>
                <dd>
                  {listing.submitter
                    ? `${listing.submitter.name} (${listing.submitter.email})`
                    : "Unknown"}
                </dd>
              </div>
              <div>
                <dt>Submitted</dt>
                <dd>{formatDate(listing.createdAt)}</dd>
              </div>
              <div>
                <dt>Reviewed</dt>
                <dd>{listing.reviewedAt ? formatDate(listing.reviewedAt) : "Not yet"}</dd>
              </div>
            </dl>
          </section>

          <button
            type="button"
            className="admin-text-link justify-self-start"
            disabled={busy}
            onClick={() => {
              if (confirm(`Delete "${listing.title}" and its screenshots? This can't be undone.`)) {
                void run(() => remove({ id }), () => router.push("/review"));
              }
            }}
          >
            Delete submission permanently
          </button>
        </aside>
      </div>
    </>
  );
}
