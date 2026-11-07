"use client";

import { showError } from "./Alerts";
import Link from "next/link";
import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import { formatDate, storefrontSiteUrl } from "@/lib/storefront";
import { safeHref, shortUrl, storefrontCreatorUrl, type ClaimStatus } from "./format";

type Claim = FunctionReturnType<typeof api.claims.queue>[number];

const TABS: { status: ClaimStatus; label: string }[] = [
  { status: "pending", label: "Pending" },
  { status: "approved", label: "Approved" },
  { status: "rejected", label: "Rejected" },
];

const EMPTY: Record<ClaimStatus, { title: string; body: string }> = {
  pending: { title: "All caught up.", body: "No claims are waiting for a decision." },
  approved: { title: "Nothing approved yet.", body: "Approved claims hand ownership to the claimant." },
  rejected: { title: "Nothing rejected.", body: "Rejected claims land here with their reason." },
};

const CLAIM_STATUS_BADGE: Record<ClaimStatus, string> = {
  pending: "pending",
  approved: "awarded",
  rejected: "rejected",
};

function ClaimRow({ claim }: { claim: Claim }) {
  const approve = useMutation(api.claims.approve);
  const reject = useMutation(api.claims.reject);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  }

  const typeLabel = claim.targetType === "listing" ? "Site" : "Creator";
  const href = claim.target
    ? claim.targetType === "listing"
      ? storefrontSiteUrl(claim.target.slug)
      : storefrontCreatorUrl(claim.target.slug)
    : null;
  const noteId = `claim-note-${claim.id}`;
  const proofHref = safeHref(claim.proofUrl);

  return (
    <li className="claim-card">
      <div className="claim-card-main">
        <div className="min-w-0">
          <p className="admin-eyebrow">
            {typeLabel} claim · {formatDate(claim.createdAt)}
          </p>
          <h2>
            {claim.target && href ? (
              <a href={href} target="_blank" rel="noopener noreferrer" className="hover:underline underline-offset-4">
                {claim.target.name} <span aria-hidden="true">↗</span>
              </a>
            ) : (
              "Deleted target"
            )}
          </h2>
          {claim.target?.isClaimed && claim.status === "pending" && (
            <p className="claim-meta">Already claimed by someone else.</p>
          )}
        </div>
        <span className="admin-status" data-status={CLAIM_STATUS_BADGE[claim.status]}>
          <span className="admin-status-dot" aria-hidden="true" />
          {claim.status}
        </span>
      </div>

      <dl className="request-fields">
        <div>
          <dt>Claimant</dt>
          <dd>
            {claim.claimant ? (
              <>
                {claim.claimant.name}
                <br />
                <a href={`mailto:${claim.claimant.email}`} className="underline underline-offset-4">
                  {claim.claimant.email}
                </a>
              </>
            ) : (
              "Unknown user"
            )}
          </dd>
        </div>
        <div>
          <dt>Proof</dt>
          <dd>
            {proofHref ? (
              <a href={proofHref} target="_blank" rel="noopener noreferrer nofollow" className="underline underline-offset-4">
                {shortUrl(proofHref)}
              </a>
            ) : (
              (claim.proofUrl ?? "None given")
            )}
          </dd>
        </div>
        <div className="wide">
          <dt>Message</dt>
          <dd className="whitespace-pre-line">{claim.message}</dd>
        </div>
        {claim.reviewNote && (
          <div className="wide">
            <dt>Reason</dt>
            <dd>{claim.reviewNote}</dd>
          </div>
        )}
      </dl>

      {claim.status === "pending" && (
        <div className="claim-actions">
          {error && (
            <p role="alert" className="text-sm font-medium">
              {error}
            </p>
          )}
          <div className="flex flex-wrap items-start gap-3">
            <button
              type="button"
              className="admin-button"
              disabled={busy || !claim.target}
              onClick={() => {
                if (
                  confirm(
                    `Hand ${claim.target?.name ?? "this target"} to ${claim.claimant?.name ?? "this user"}? Competing claims will be rejected.`,
                  )
                ) {
                  void run(() => approve({ id: claim.id }));
                }
              }}
            >
              Approve claim
            </button>
            <div className="grid min-w-[240px] flex-1 gap-2">
              <label htmlFor={noteId} className="sr-only">
                Reason for rejecting
              </label>
              <input
                id={noteId}
                className="admin-input"
                maxLength={500}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Reason for rejecting, e.g. No proof of ownership."
              />
            </div>
            <button
              type="button"
              className="admin-button admin-button-secondary"
              disabled={busy || !note.trim()}
              onClick={() => run(() => reject({ id: claim.id, note }))}
            >
              Reject
            </button>
          </div>
        </div>
      )}
    </li>
  );
}

export function ClaimsQueue({ status }: { status: ClaimStatus }) {
  const pending = useQuery(api.claims.pendingCount, {});
  const rows = useQuery(api.claims.queue, { status });

  return (
    <>
      <div className="admin-page-heading">
        <div>
          <p className="admin-eyebrow">03 / Claims</p>
          <h1>Claims.</h1>
          <p>
            Owners claiming an imported site or creator profile. Approving makes them the owner.
          </p>
        </div>
        <nav className="admin-tabs" aria-label="Filter by status">
          {TABS.map((tab) => (
            <Link
              key={tab.status}
              href={`/claims?status=${tab.status}`}
              aria-current={tab.status === status ? "page" : undefined}
            >
              {tab.label}
              {tab.status === "pending" && <span>{pending ?? "·"}</span>}
            </Link>
          ))}
        </nav>
      </div>

      {rows === undefined ? (
        <p className="admin-eyebrow">Loading…</p>
      ) : rows.length === 0 ? (
        <div className="admin-empty">
          <h2>{EMPTY[status].title}</h2>
          {EMPTY[status].body}
        </div>
      ) : (
        <ul className="request-list">
          {rows.map((claim) => (
            <ClaimRow key={claim.id} claim={claim} />
          ))}
        </ul>
      )}
    </>
  );
}
