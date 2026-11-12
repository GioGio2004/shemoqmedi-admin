"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { QUEUE_TABS, type QueueTab } from "@/lib/studio/queue";
import { useNow } from "../hooks";
import { ErrorBoundary, PageHead, Skel } from "../ui";
import { PostCard } from "./PostCard";

/** Updates the address bar without a server round trip (Next keeps useSearchParams in sync). */
function setQuery(tab: QueueTab, post: string | null) {
  const q = new URLSearchParams();
  if (tab !== "waiting") q.set("status", tab);
  if (post) q.set("post", post);
  const s = q.toString();
  window.history.replaceState(null, "", s ? `?${s}` : window.location.pathname);
}

/** The queue: one tab per status, posts as cards; ?post=<id> opens that post on top. */
export function Queue({ initialTab, postId }: { initialTab: QueueTab; postId: string | null }) {
  const [tab, setTab] = useState<QueueTab>(initialTab);
  const [pin, setPin] = useState<string | null>(postId);
  const now = useNow();
  const posts = useQuery(api.social.queue, { status: tab });
  const shown = posts?.filter((p) => p.id !== pin);

  // A deep link scrolls its post into view once it has drawn.
  useEffect(() => {
    if (!postId) return;
    const t = window.setTimeout(() => document.getElementById(`post-${postId}`)?.scrollIntoView({ block: "start", behavior: "smooth" }), 250);
    return () => window.clearTimeout(t);
  }, [postId]);

  function pick(next: QueueTab) {
    setTab(next);
    setQuery(next, pin);
  }
  function unpin() {
    setPin(null);
    setQuery(tab, null);
  }

  return (
    <>
      <PageHead
        index="02"
        section="Queue"
        title="Queue."
        actions={
          <Link href="/create" className="st-btn st-btn-sm">
            New post
          </Link>
        }
      />
      <div className="st-scroll-x" style={{ marginBottom: 16 }}>
        <div className="st-seg" role="tablist" aria-label="Status">
          {QUEUE_TABS.map((t) => (
            <button key={t.id} type="button" role="tab" aria-selected={t.id === tab} onClick={() => pick(t.id)}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {pin && (
        <div style={{ marginBottom: 12 }}>
          <ErrorBoundary
            fallback={
              <div className="st-empty">
                <strong>That post link no longer works.</strong>
                <button type="button" className="st-btn st-btn-ghost st-btn-sm" onClick={unpin}>
                  Show the queue
                </button>
              </div>
            }
          >
            <Pinned id={pin} now={now} onClose={unpin} />
          </ErrorBoundary>
        </div>
      )}

      {shown === undefined ? (
        <div className="st-cards" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <Skel key={i} style={{ height: 320, borderRadius: 14 }} />
          ))}
        </div>
      ) : shown.length === 0 ? (
        <EmptyTab tab={tab} />
      ) : (
        <div className="st-cards">
          {shown.map((p) => (
            <PostCard key={p.id} post={p} now={now} />
          ))}
        </div>
      )}
    </>
  );
}

function Pinned({ id, now, onClose }: { id: string; now: number; onClose: () => void }) {
  const post = useQuery(api.social.get, { id: id as Id<"socialPosts"> });
  if (post === undefined) return <Skel style={{ height: 320, borderRadius: 14 }} />;
  return <PostCard post={post} now={now} pinned onClosePin={onClose} />;
}

const EMPTY: Record<QueueTab, string> = {
  waiting: "Nothing is waiting. New listings, awards and the weekly calls queue themselves; make one yourself in Create.",
  scheduled: "Nothing is scheduled.",
  sent: "Nothing has been published yet.",
  failed: "No failed posts.",
  approved: "No post is waiting for a connected account.",
  rejected: "No rejected posts.",
  all: "No posts yet.",
};

function EmptyTab({ tab }: { tab: QueueTab }) {
  return (
    <div className="st-empty st-in">
      <strong>{tab === "waiting" ? "All clear." : "Empty."}</strong>
      <span>{EMPTY[tab]}</span>
      {tab === "waiting" && (
        <Link href="/create" className="st-btn st-btn-sm">
          Create a post
        </Link>
      )}
    </div>
  );
}
