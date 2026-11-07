"use client";

import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { formatDate } from "@/lib/storefront";

export type ReviewStatus = "pending" | "approved" | "rejected";

export const STATUS_LABEL: Record<ReviewStatus, string> = {
  pending: "In review",
  approved: "Live",
  rejected: "Rejected",
};

const TABS: { status: ReviewStatus; label: string }[] = [
  { status: "pending", label: "Waiting" },
  { status: "approved", label: "Live" },
  { status: "rejected", label: "Rejected" },
];

export function StatusBadge({ status }: { status: ReviewStatus }) {
  return (
    <span className="admin-status" data-status={status}>
      <span className="admin-status-dot" aria-hidden="true" />
      {STATUS_LABEL[status]}
    </span>
  );
}

export function ReviewQueue({ status }: { status: ReviewStatus }) {
  const counts = useQuery(api.listings.reviewCounts, {});
  const rows = useQuery(api.listings.reviewQueue, { status });

  return (
    <>
      <div className="admin-page-heading">
        <div>
          <p className="admin-eyebrow">02 / Review</p>
          <h1>Submissions.</h1>
          <p>
            Every site starts here. Approve what belongs in the showcase; reject the rest with a
            short reason the creator will see.
          </p>
        </div>
        <nav className="admin-tabs" aria-label="Filter by status">
          {TABS.map((tab) => (
            <Link
              key={tab.status}
              href={`/review?status=${tab.status}`}
              aria-current={tab.status === status ? "page" : undefined}
            >
              {tab.label}
              <span>{counts ? counts[tab.status] : "·"}</span>
            </Link>
          ))}
        </nav>
      </div>

      {rows === undefined ? (
        <p className="admin-eyebrow">Loading…</p>
      ) : rows.length === 0 ? (
        <div className="admin-empty">
          <h2>{status === "pending" ? "All caught up." : "Nothing here yet."}</h2>
          {status === "pending"
            ? "No submissions are waiting for review."
            : `No ${STATUS_LABEL[status].toLowerCase()} submissions.`}
        </div>
      ) : (
        <ul className="request-list">
          {rows.map((row) => (
            <li key={row.id}>
              <Link href={`/review/${row.id}`} className="request-list-card">
                <div className="request-thumb">
                  {row.coverUrl && <img src={row.coverUrl} alt="" />}
                </div>
                <div className="min-w-0">
                  <p className="admin-eyebrow">{row.categoryName}</p>
                  <h2>{row.title}</h2>
                  <p>{row.url.replace(/^https?:\/\//, "")}</p>
                </div>
                <div className="min-w-0">
                  <p>
                    {row.submitter ? `${row.submitter.name} · ${row.submitter.email}` : "Unknown submitter"}
                  </p>
                  <p>Submitted {formatDate(row.createdAt)}</p>
                </div>
                <div className="request-card-end">
                  <StatusBadge status={row.status} />
                  <span className="admin-arrow" aria-hidden="true">↗</span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
