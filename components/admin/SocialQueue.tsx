"use client";

import Link from "next/link";
import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import { showError } from "./Alerts";
import { formatDate } from "@/lib/storefront";

type Post = FunctionReturnType<typeof api.social.queue>[number];
export type SocialTab = "waiting" | "approved" | "rejected" | "all";

const TABS: { status: SocialTab; label: string }[] = [
  { status: "waiting", label: "Waiting" },
  { status: "approved", label: "Approved" },
  { status: "rejected", label: "Rejected" },
  { status: "all", label: "All" },
];

const KIND: Record<string, string> = {
  award: "Award",
  new_listing: "New listing",
  call_submissions: "Call for submissions",
  call_jury: "Call for jurors",
  roundup: "Weekly roundup",
  announcement: "Announcement",
  custom: "Post",
};

const STATUS_BADGE: Record<string, string> = {
  waiting: "pending",
  approved: "in_voting",
  scheduled: "in_voting",
  sent: "awarded",
  failed: "rejected",
  rejected: "rejected",
};

const NETWORKS = [
  ["instagram", "Instagram"],
  ["facebook", "Facebook"],
  ["linkedin", "LinkedIn"],
] as const;

function PostRow({ post }: { post: Post }) {
  const approve = useMutation(api.social.approve);
  const reject = useMutation(api.social.reject);
  const [busy, setBusy] = useState(false);
  const hasCaption = NETWORKS.some(([n]) => post.captions[n]);

  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="claim-card">
      <div className="claim-card-main">
        <div className="min-w-0">
          <p className="admin-eyebrow">
            {KIND[post.kind] ?? post.kind} · queued {formatDate(post.createdAt)}
            {post.scheduledFor ? ` · publish ${new Date(post.scheduledFor).toLocaleString()}` : ""}
          </p>
          <h2>{post.listing?.title ?? KIND[post.kind] ?? "Post"}</h2>
          {post.note && <p className="claim-meta">{post.note}</p>}
          {post.error && (
            <p role="alert" className="claim-meta font-medium">
              {post.error}
            </p>
          )}
        </div>
        <span className="admin-status" data-status={STATUS_BADGE[post.status] ?? "pending"}>
          <span className="admin-status-dot" aria-hidden="true" />
          {post.status}
        </span>
      </div>

      {post.media.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-1" aria-label="Media">
          {post.media.map((m) =>
            m.kind === "image" ? (
              <img key={m.url} src={m.url} alt={m.role ?? "image"} className="h-24 w-auto rounded-md border border-black/10" loading="lazy" />
            ) : (
              <video key={m.url} src={m.url} muted playsInline className="h-24 w-auto rounded-md border border-black/10" />
            ),
          )}
        </div>
      )}

      <dl className="request-fields">
        {NETWORKS.map(([network, label]) => (
          <div key={network} className="wide">
            <dt>{label}</dt>
            <dd className="whitespace-pre-line">{post.captions[network] ?? "—"}</dd>
          </div>
        ))}
      </dl>

      {post.status === "waiting" && (
        <div className="claim-actions">
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              className="admin-button"
              disabled={busy || !hasCaption}
              onClick={() => act(() => approve({ id: post.id }))}
            >
              Approve
            </button>
            <button
              type="button"
              className="admin-button admin-button-secondary"
              disabled={busy}
              onClick={() => {
                const note = prompt("Why drop this post? (optional)") ?? undefined;
                void act(() => reject({ id: post.id, note }));
              }}
            >
              Reject
            </button>
            {!hasCaption && (
              <span className="text-xs text-black/55">
                No captions yet. Ask Claude: “what’s waiting on the social desk?”
              </span>
            )}
          </div>
        </div>
      )}
    </li>
  );
}

export function SocialQueue({ status }: { status: SocialTab }) {
  const waiting = useQuery(api.social.waitingCount, {});
  const rows = useQuery(api.social.queue, { status });

  return (
    <>
      <div className="admin-page-heading">
        <div>
          <p className="admin-eyebrow">Social desk</p>
          <h1>Social.</h1>
          <p>
            Posts the site queues by itself (awards, new listings, weekly calls, the Sunday roundup). Claude writes the
            captions through the Shemoqmedi connector; you approve them here or in the chat.
          </p>
        </div>
        <nav className="admin-tabs" aria-label="Filter by status">
          {TABS.map((tab) => (
            <Link
              key={tab.status}
              href={`/social?status=${tab.status}`}
              aria-current={tab.status === status ? "page" : undefined}
            >
              {tab.label}
              {tab.status === "waiting" && <span>{waiting ?? "·"}</span>}
            </Link>
          ))}
        </nav>
      </div>

      {rows === undefined ? (
        <p className="admin-eyebrow">Loading…</p>
      ) : rows.length === 0 ? (
        <div className="admin-empty">
          <h2>Nothing here.</h2>
          {status === "waiting" ? "No posts are waiting. New ones appear as awards and listings go live." : "No posts with this status."}
        </div>
      ) : (
        <ul className="request-list">
          {rows.map((post) => (
            <PostRow key={post.id} post={post} />
          ))}
        </ul>
      )}
    </>
  );
}
