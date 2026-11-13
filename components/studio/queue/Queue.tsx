"use client";

import "@/app/studio/screens/queue.css";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { QUEUE_TABS, type QueueTab } from "@/lib/studio/queue";
import { useAmbient } from "../Ambient";
import { useMedia, useNow } from "../hooks";
import { ErrorBoundary, PageHead, Segmented, Skel } from "../ui";
import { useFeedLayout } from "./layout";
import { PostCard, type OpenFrom, type Post } from "./PostCard";
import { PostDetail } from "./PostDetail";
import { channelMap } from "./view";

/** Updates the address bar without a server round trip (Next keeps useSearchParams in sync). */
function setQuery(tab: QueueTab, post: string | null) {
  const q = new URLSearchParams();
  if (tab !== "waiting") q.set("status", tab);
  if (post) q.set("post", post);
  const s = q.toString();
  window.history.replaceState(null, "", s ? `?${s}` : window.location.pathname);
}

type Detail = { id: string; open: boolean; from: OpenFrom | null; initial: Post | null };

/**
 * The queue: a large title with a one-line summary, a sticky status filter
 * with counts (one tab per status, ?status= in the address), and the posts as
 * visual cards (one column on phones, masonry from 640px). A card opens the
 * post's detail sheet; ?post=<id> opens it from a link (publish pushes).
 */
export function Queue({ initialTab, postId }: { initialTab: QueueTab; postId: string | null }) {
  const [tab, setTab] = useState<QueueTab>(initialTab);
  const [detail, setDetail] = useState<Detail | null>(postId ? { id: postId, open: true, from: null, initial: null } : null);
  const now = useNow();
  const posts = useQuery(api.social.queue, { status: tab });
  const all = useQuery(api.social.queue, { status: "all" });
  const waiting = useQuery(api.social.waitingCount, {});
  const channelList = useQuery(api.social.channels, {});
  const channels = useMemo(() => channelMap(channelList), [channelList]);

  // While a newly picked tab loads, the last list stays (then the cards move to the new one).
  const [last, setLast] = useState(posts);
  if (posts !== undefined && posts !== last) setLast(posts);
  const list = posts ?? last;

  const feed = useRef<HTMLDivElement>(null);
  const masonry = useMedia("(min-width: 640px)");
  useFeedLayout(feed, list ? list.map((p) => p.id).join(",") : "", masonry);
  useAmbient(list?.slice(0, 4).map((p) => p.media.find((m) => m.kind === "image")?.url));

  // Counts per status from the latest 100 posts; Waiting's is exact (its own count).
  const counts = useMemo(() => {
    if (!all) return null;
    const c: Record<QueueTab, number> = { waiting: 0, scheduled: 0, sent: 0, failed: 0, approved: 0, rejected: 0, all: all.length };
    for (const p of all) {
      c[p.status] += 1;
    }
    return { c, capped: all.length >= 100 };
  }, [all]);
  const countOf = (t: QueueTab) => (t === "waiting" ? (waiting ?? counts?.c.waiting) : counts && !counts.capped ? counts.c[t] : undefined);

  // Keep the picked filter in view inside its scrolling capsule.
  useEffect(() => {
    document.getElementById(`qf-${tab}`)?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
  }, [tab]);

  function pick(next: QueueTab) {
    setTab(next);
    setQuery(next, detail?.open ? detail.id : null);
  }
  function openPost(post: Post, from: OpenFrom) {
    setDetail({ id: post.id, open: true, from, initial: post });
    setQuery(tab, post.id);
  }
  function closePost() {
    setDetail((d) => (d ? { ...d, open: false } : d));
    setQuery(tab, null);
  }
  function dropPost() {
    setDetail(null);
    setQuery(tab, null);
  }

  const summary = summaryOf(waiting ?? counts?.c.waiting, counts?.c.scheduled, counts?.c.failed, () => pick("failed"));

  return (
    <div className="st-queue">
      <PageHead section="Shemoqmedi Studio" title="Queue" lede={<span aria-live="polite">{summary}</span>} />

      <div className="st-queue-filter">
        <Segmented
          label="Filter posts by status"
          value={tab}
          onChange={pick}
          options={QUEUE_TABS.map((t) => ({ value: t.id, label: t.label, count: countOf(t.id), id: `qf-${t.id}`, controls: "st-queue-feed" }))}
        />
      </div>

      {detail && (
        <ErrorBoundary
          key={detail.id}
          fallback={
            <div className="st-empty st-queue-gone">
              <strong>That post link no longer works.</strong>
              <button type="button" className="st-btn st-btn-ghost st-btn-sm" onClick={dropPost}>
                Show the queue
              </button>
            </div>
          }
        >
          <PostDetail id={detail.id} initial={detail.initial} open={detail.open} from={detail.from} now={now} channels={channels} onClose={closePost} />
        </ErrorBoundary>
      )}

      <div id="st-queue-feed" role="tabpanel" aria-labelledby={`qf-${tab}`} aria-busy={posts === undefined || undefined}>
        {list === undefined ? (
          <div className="st-queue-feed is-skel">
            {[0, 1, 2].map((i) => (
              <div key={i} className="st-queue-skel" aria-hidden="true">
                <Skel className="st-queue-skel-media" />
                <Skel className="st-skel-text" />
              </div>
            ))}
          </div>
        ) : list.length === 0 ? (
          <EmptyTab tab={tab} />
        ) : (
          <div ref={feed} className="st-queue-feed" data-stale={posts === undefined || undefined}>
            {list.map((p, i) => (
              <PostCard key={p.id} post={p} now={now} channels={channels} eager={i < 3} onOpen={openPost} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** "3 waiting · 1 scheduled · 1 failed" (the failed part filters), or "All caught up". */
function summaryOf(waiting: number | undefined, scheduled: number | undefined, failed: number | undefined, showFailed: () => void): ReactNode {
  if (waiting === undefined && scheduled === undefined) return " ";
  const parts: ReactNode[] = [];
  if (waiting) parts.push(<span key="w"><b>{waiting}</b> waiting</span>);
  if (scheduled) parts.push(<span key="s"><b>{scheduled}</b> scheduled</span>);
  if (failed)
    parts.push(
      <button key="f" type="button" className="st-queue-failed-link" onClick={showFailed}>
        {failed} failed
      </button>,
    );
  if (!parts.length) return "All caught up";
  return parts.flatMap((p, i) => (i ? [<span key={`d${i}`} aria-hidden="true"> · </span>, p] : [p]));
}

const EMPTY: Record<QueueTab, [string, string]> = {
  waiting: ["All clear.", "Nothing is waiting. New listings, awards and the weekly calls queue themselves; make one yourself in Create."],
  scheduled: ["Nothing scheduled.", "Pick a time on any waiting post."],
  sent: ["Nothing sent yet.", "Published posts land here."],
  failed: ["No failures.", "Every post went out cleanly."],
  approved: ["All connected.", "No post is waiting for a connected account."],
  rejected: ["Nothing rejected.", "Rejected posts land here."],
  all: ["No posts yet.", "New posts show up here."],
};

function EmptyTab({ tab }: { tab: QueueTab }) {
  const [head, text] = EMPTY[tab];
  return (
    <div className="st-empty st-queue-empty st-in">
      <strong>{head}</strong>
      <span>{text}</span>
      {tab === "waiting" && (
        <Link href="/create" className="st-btn st-btn-sm">
          Create a post
        </Link>
      )}
    </div>
  );
}
