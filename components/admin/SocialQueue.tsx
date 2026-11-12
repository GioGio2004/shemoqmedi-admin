"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import { showError } from "./Alerts";
import { formatDate } from "@/lib/storefront";
import { publishState } from "@/lib/socialPublishState";

type Post = FunctionReturnType<typeof api.social.queue>[number];
type Result = Post["results"][number];
export type SocialTab = "waiting" | "scheduled" | "sent" | "failed" | "approved" | "rejected" | "all";

const TABS: { status: SocialTab; label: string }[] = [
  { status: "waiting", label: "Waiting" },
  { status: "scheduled", label: "Scheduled" },
  { status: "sent", label: "Sent" },
  { status: "failed", label: "Failed" },
  { status: "approved", label: "Not connected" },
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
  ["threads", "Threads"],
  ["linkedin", "LinkedIn"],
] as const;

const RESULT_BADGE: Record<Result["status"], string> = { sent: "awarded", failed: "rejected", skipped: "pending" };

function ResultLine({ result }: { result: Result | undefined }) {
  if (!result) return null;
  return (
    <span className="mt-1 flex flex-wrap items-center gap-2 text-xs">
      <span className="admin-status" data-status={RESULT_BADGE[result.status]}>
        <span className="admin-status-dot" aria-hidden="true" />
        {result.status}
      </span>
      {result.url && (
        <a href={result.url} target="_blank" rel="noopener noreferrer" className="underline">
          View post
        </a>
      )}
      {result.error && <span className="text-black/70">{result.error}</span>}
      {result.note && <span className="text-black/55">{result.note}</span>}
    </span>
  );
}

/**
 * The time, ticking every 15 seconds. A publish run's lease is compared with
 * this clock, not with the server's `publishing` flag: a query result is not
 * re-run as time passes, so that flag can stay true after a run died.
 */
function useNow(everyMs = 15_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(timer);
  }, [everyMs]);
  return now;
}

function PostRow({ post, now }: { post: Post; now: number }) {
  const approve = useMutation(api.social.approve);
  const reject = useMutation(api.social.reject);
  const retry = useMutation(api.social.retry);
  const [busy, setBusy] = useState(false);
  const hasCaption = NETWORKS.some(([n]) => post.captions[n]);
  const { publishing, stalled, legacy, canRetry } = publishState(post, now);

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
            {post.sentAt ? ` · sent ${new Date(post.sentAt).toLocaleString()}` : ""}
            {publishing ? " · publishing now…" : ""}
            {stalled ? " · the publish run stopped" : ""}
          </p>
          <h2>{post.listing?.title ?? KIND[post.kind] ?? "Post"}</h2>
          {post.note && <p className="claim-meta">{post.note}</p>}
          {stalled && (
            <p role="alert" className="claim-meta font-medium">
              The publish run stopped before it finished (it may have timed out). Retry sends the networks that aren’t
              sent yet.
            </p>
          )}
          {legacy && (
            <p className="claim-meta">
              Approved before publishing was connected: nothing was published from here, but it may have been posted by
              hand. To publish it, ask Claude to send it back to waiting, then approve it again.
            </p>
          )}
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
          {post.media.map((m, i) => {
            const label = `${m.role ?? m.kind}${m.networks?.length ? ` (${m.networks.join(", ")})` : ""}`;
            return m.kind === "image" ? (
              <img key={`${i}-${m.url}`} src={m.url} alt={label} title={label} className="h-24 w-auto rounded-md border border-black/10" loading="lazy" />
            ) : (
              <video key={`${i}-${m.url}`} src={m.url} title={label} muted playsInline className="h-24 w-auto rounded-md border border-black/10" />
            );
          })}
        </div>
      )}

      <dl className="request-fields">
        {NETWORKS.map(([network, label]) => (
          <div key={network} className="wide">
            <dt>{label}</dt>
            <dd>
              <span className="whitespace-pre-line">{post.captions[network] ?? "—"}</span>
              <ResultLine result={post.results.find((r) => r.network === network)} />
            </dd>
          </div>
        ))}
      </dl>

      {canRetry && (
        <div className="claim-actions">
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" className="admin-button" disabled={busy} onClick={() => act(() => retry({ id: post.id }))}>
              Retry
            </button>
            <span className="text-xs text-black/55">Sends only the networks that aren’t sent yet.</span>
          </div>
        </div>
      )}

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
  const now = useNow();

  return (
    <>
      <div className="admin-page-heading">
        <div>
          <p className="admin-eyebrow">Social desk</p>
          <h1>Social.</h1>
          <p>
            Posts the site queues by itself (awards, new listings, weekly calls, the Sunday roundup). Claude writes the
            captions and renders the graphics through the Shemoqmedi connector; you approve them here or in the chat,
            and approval publishes to Facebook, Instagram, Threads and LinkedIn.
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
            <PostRow key={post.id} post={post} now={now} />
          ))}
        </ul>
      )}
    </>
  );
}
