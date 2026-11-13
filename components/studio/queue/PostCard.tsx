"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { captionsDiffer, type Captions } from "@/lib/studio/captions";
import { KIND_LABEL, captionDrafts, staleCaptionDraft } from "@/lib/studio/queue";
import { firstReelIndex, reelChipText } from "@/lib/studio/reelPost";
import { relativeTime } from "@/lib/studio/time";
import { useDraft } from "../hooks";
import { CheckIcon, ClockIcon, ExternalIcon, ReelIcon } from "../icons";
import { Lightbox } from "../Lightbox";
import { Carousel, type CarouselControl } from "./Carousel";
import { usePostControls } from "./controls";
import { NetGlyph } from "./glyphs";
import { captionTitle, excerpt, formatText, listNames, networkStates, postTitle, statusKey, statusWord, targetNetworks, whenText, type Channels, type Post, type StatusKey } from "./view";

export type { Post } from "./view";

/**
 * A post's caption edits not saved yet. They live outside the card and the
 * sheet (lib/studio/queue.ts captionDrafts): a tab switch, closing the sheet
 * or the post moving tabs remounts them, and the edits are still there (also
 * after a reload). A draft that no longer applies is dropped.
 */
export function useCaptionDraft(post: Post) {
  const kept = useDraft(captionDrafts, post.id);
  const stale = staleCaptionDraft(kept, post);
  const draft = stale ? null : kept;
  useEffect(() => {
    if (stale) captionDrafts.set(post.id, null);
  }, [stale, post.id]);
  const setDraft = useCallback((next: Captions | null) => captionDrafts.set(post.id, next), [post.id]);
  const captions = draft ?? post.captions;
  const dirty = draft !== null && captionsDiffer(draft, post.captions);
  return { draft, setDraft, captions, dirty };
}

/** Where the detail sheet opens from: the card's picture (for the shared-element motion) and its slide. */
export type OpenFrom = { el: HTMLElement | null; index: number };

/** The status chip over the picture. */
export function StatusChip({ status }: { status: StatusKey }) {
  return (
    <span className="st-mchip" data-status={status}>
      {status === "waiting" && <span className="st-sdot is-ring" aria-hidden="true" />}
      {status === "scheduled" && <ClockIcon size={14} />}
      {status === "sent" && <CheckIcon size={14} />}
      {status === "failed" && <span className="st-sdot is-failed" aria-hidden="true" />}
      {status === "publishing" && <span className="st-dot" data-tone="live" aria-hidden="true" />}
      {(status === "approved" || status === "rejected") && <span className="st-sdot" aria-hidden="true" />}
      {statusWord(status)}
    </span>
  );
}

/**
 * One post, visual first: the graphic flush at its own shape (swipe the
 * carousel, tap a picture for the picture view), a glass pill with where and
 * when it goes, the title and two lines of caption, and at most two actions.
 * Tapping the card opens the detail sheet.
 */
export function PostCard({ post, now, channels, eager, onOpen }: { post: Post; now: number; channels: Channels; eager: boolean; onOpen: (post: Post, from: OpenFrom) => void }) {
  const c = usePostControls(post, now);
  const { captions, dirty } = useCaptionDraft(post);
  const article = useRef<HTMLElement>(null);
  const car = useRef<CarouselControl>(null);
  const [near, setNear] = useState(eager);
  const [viewer, setViewer] = useState<{ index: number; el: HTMLElement } | null>(null);
  // A reel shows a chip with its length (read from the video once it loads).
  const reelAt = firstReelIndex(post.media);
  const [reelSec, setReelSec] = useState<{ url: string; sec: number } | null>(null);
  const reelUrl = reelAt >= 0 ? post.media[reelAt].url : null;

  // Pictures load once the card comes within a screen or so.
  useEffect(() => {
    const el = article.current;
    if (near || !el) return;
    if (typeof IntersectionObserver === "undefined") {
      const t = window.setTimeout(() => setNear(true), 0);
      return () => window.clearTimeout(t);
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setNear(true);
          io.disconnect();
        }
      },
      { rootMargin: "800px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [near]);

  const { actions, busy } = c;
  const key = statusKey(post, actions);
  const story = post.placement === "story";
  const title = postTitle(post, captions);
  const text = story ? "" : excerpt(captions, title === captionTitle(captions));
  const nets = networkStates(post, captions, channels);
  const off = busy !== null || dirty;

  const open = () => onOpen(post, { el: car.current?.media(car.current.index()) ?? null, index: car.current?.index() ?? 0 });
  // The card's press waits a beat on touch (like iOS), so scrolling the feed doesn't squash every card it passes.
  const pressTimer = useRef(0);
  const press = (on: boolean, touch = false) => {
    window.clearTimeout(pressTimer.current);
    if (on && touch) pressTimer.current = window.setTimeout(() => article.current?.classList.add("is-pressed"), 90);
    else article.current?.classList.toggle("is-pressed", on);
  };

  return (
    <article ref={article} className="st-card is-flush st-queue-card" data-flip={post.id} data-status={key} data-busy={busy !== null && busy !== "save" ? "true" : undefined} id={`post-${post.id}`}>
      {post.media.length > 0 && (
        <Carousel
          control={car}
          className="st-card-media"
          media={post.media}
          label={title}
          story={story}
          eager={eager}
          near={near}
          sizes="(min-width: 900px) 420px, (min-width: 640px) 50vw, 100vw"
          top={
            <>
              <StatusChip status={key} />
              {story && <span className="st-mchip">Story</span>}
              {reelUrl && (
                <span className="st-mchip">
                  <ReelIcon size={14} />
                  <span className="st-tnum">{reelChipText(reelSec?.url === reelUrl ? reelSec.sec : null)}</span>
                </span>
              )}
            </>
          }
          onVideoMeta={(i, sec) => {
            if (i === reelAt && reelUrl) setReelSec({ url: reelUrl, sec });
          }}
          bottom={
            <div className="st-mchip st-queue-pill">
              {nets.map((n) => (
                <span key={n.network} className="st-queue-ng" data-on={n.on || undefined} role="img" aria-label={n.label} title={n.label}>
                  <NetGlyph network={n.network} size={15} />
                </span>
              ))}
              <span className="st-queue-pill-sep" aria-hidden="true" />
              <span className="st-tnum">{whenText(post, key, now)}</span>
            </div>
          }
          onOpen={(index, el) => setViewer({ index, el })}
        />
      )}

      <div className="st-card-body">
        <button
          type="button"
          className="st-queue-open"
          aria-label={`Open ${title}, ${statusWord(key)}`}
          onClick={open}
          onPointerDown={(e) => press(true, e.pointerType === "touch")}
          onPointerUp={() => press(false)}
          onPointerCancel={() => press(false)}
          onPointerLeave={() => press(false)}
        />
        <div className="st-card-head">
          <h3 className="st-card-title">{title}</h3>
          <span className="st-card-meta">{formatText(post)}</span>
        </div>
        <p className="st-queue-sub">
          {KIND_LABEL[post.kind] ?? post.kind} · <span className="st-tnum">{relativeTime(post.createdAt, now)}</span>
        </p>
        {text && <p className="st-card-text">{text}</p>}
        {story && <p className="st-card-text">{targetNetworks(post, captions).length ? `Story on ${listNames(targetNetworks(post, captions))}.` : "Story, no network picked."}</p>}
        {key === "failed" && (
          <p className="st-card-error">
            <span className="st-sdot is-failed" aria-hidden="true" />
            <span>{post.error ?? "Publishing failed."}</span>
          </p>
        )}
        {key === "rejected" && post.note && <p className="st-note">Note: {post.note}</p>}
        <CardActions post={post} status={key} c={c} dirty={dirty} off={off} onOpen={open} />
      </div>

      {c.sheets}
      {viewer && (
        <Lightbox
          items={post.media.map((m) => ({ url: m.url, kind: m.kind }))}
          start={viewer.index}
          origin={viewer.el}
          originFor={(i) => car.current?.media(i) ?? null}
          onIndexChange={(i) => car.current?.go(i, false)}
          label={title}
          onClose={() => setViewer(null)}
        />
      )}
    </article>
  );
}

/** At most two: Schedule + Publish, Move time + Publish now, Details + Retry, or the sent line. */
function CardActions({ post, status, c, dirty, off, onOpen }: { post: Post; status: StatusKey; c: ReturnType<typeof usePostControls>; dirty: boolean; off: boolean; onOpen: () => void }) {
  const { actions, busy } = c;
  if (actions.publishing) return <p className="st-note st-queue-line">Publishing now. Videos can take a few minutes; the results show here.</p>;
  if (dirty && actions.edit) {
    return (
      <div className="st-queue-actions">
        <p className="st-note">Unsaved caption edits. Save or discard them first.</p>
        <button type="button" className="st-btn st-btn-ghost st-btn-sm" onClick={onOpen}>
          Review edits
        </button>
      </div>
    );
  }
  if (status === "sent") {
    const sent = post.results.filter((r) => r.status === "sent");
    const link = sent.find((r) => r.url);
    return (
      <div className="st-queue-sent">
        <CheckIcon size={16} />
        <span>{sent.length ? `Sent to ${listNames(sent.map((r) => r.network))}` : "Sent"}</span>
        {actions.retry ? (
          <button type="button" className="st-btn st-btn-sm" onClick={c.retry} disabled={off} data-busy={busy === "retry"}>
            Retry
          </button>
        ) : (
          link?.url && (
            <a className="st-btn st-btn-ghost st-btn-sm" href={link.url} target="_blank" rel="noopener noreferrer">
              View <ExternalIcon size={15} />
            </a>
          )
        )}
      </div>
    );
  }
  if (actions.retry) {
    return (
      <div className="st-queue-actions">
        <button type="button" className="st-btn st-btn-ghost" onClick={onOpen} disabled={busy !== null}>
          Details
        </button>
        <button type="button" className="st-btn" onClick={c.retry} disabled={off} data-busy={busy === "retry"}>
          Retry
        </button>
      </div>
    );
  }
  if (actions.publishNow || actions.schedule) {
    return (
      <div className="st-queue-actions">
        {actions.schedule && (
          <button type="button" className="st-btn st-btn-ghost" onClick={c.askSchedule} disabled={off} data-busy={busy === "schedule"}>
            <ClockIcon size={17} />
            {actions.unschedule ? "Move time" : "Schedule"}
          </button>
        )}
        {actions.publishNow && (
          <button type="button" className="st-btn" onClick={c.askPublish} disabled={off} data-busy={busy === "publish"}>
            {actions.unschedule ? "Publish now" : "Publish"}
          </button>
        )}
      </div>
    );
  }
  return null;
}
