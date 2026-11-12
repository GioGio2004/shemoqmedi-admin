"use client";

import { useEffect, useState } from "react";
import { useMutation } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import { showAlert, showError } from "@/components/admin/Alerts";
import { NETWORK_LABEL, captionedNetworks, captionsDiffer, captionsFit, captionsForSave, type Captions, type Network } from "@/lib/studio/captions";
import { KIND_LABEL, STATUS_LABEL, captionDrafts, postActions, staleCaptionDraft } from "@/lib/studio/queue";
import { formatTbilisi, relativeTime } from "@/lib/studio/time";
import { CaptionEditor, StoryNetworks } from "../CaptionEditor";
import { useDraft } from "../hooks";
import { ArrowIcon } from "../icons";
import { RejectSheet, TimeSheet } from "../TimeSheet";
import { ConfirmSheet } from "../ui";
import { dropFromQueues } from "./optimistic";

export type Post = FunctionReturnType<typeof api.social.queue>[number];
type Result = Post["results"][number];

const STATUS_TONE: Record<string, "ink" | "blue" | "mute" | undefined> = {
  scheduled: "blue",
  sent: "ink",
  failed: undefined,
  rejected: "mute",
  approved: "mute",
};

/** One post: its media, captions per network (editable in place), results, and what can be done with it. */
export function PostCard({ post, now, pinned, onClosePin }: { post: Post; now: number; pinned?: boolean; onClosePin?: () => void }) {
  const update = useMutation(api.social.update);
  const publish = useMutation(api.social.publish).withOptimisticUpdate((store, { id }) => dropFromQueues(store, id, ["all", "scheduled"]));
  const unschedule = useMutation(api.social.unschedule).withOptimisticUpdate((store, { id }) => dropFromQueues(store, id, ["all", "waiting"]));
  const reject = useMutation(api.social.reject).withOptimisticUpdate((store, { id }) => dropFromQueues(store, id, ["all", "rejected"]));
  const retry = useMutation(api.social.retry).withOptimisticUpdate((store, { id }) => dropFromQueues(store, id, ["all", "scheduled", "sent"]));

  // Unsaved caption edits live outside the card (lib/studio/queue.ts captionDrafts): a tab switch, closing a
  // pinned post or the post moving tabs remounts the card, and the edits are still there.
  const kept = useDraft(captionDrafts, post.id);
  const setDraft = (next: Captions | null) => captionDrafts.set(post.id, next);
  const stale = staleCaptionDraft(kept, post);
  const draft = stale ? null : kept;
  useEffect(() => {
    if (stale) captionDrafts.set(post.id, null);
  }, [stale, post.id]);
  const [sheet, setSheet] = useState<"publish" | "schedule" | "reject" | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const actions = postActions(post, now);
  const story = post.placement === "story";
  const captions = draft ?? post.captions;
  const dirty = draft !== null && captionsDiffer(draft, post.captions);
  const networks = captionedNetworks(post.captions);
  const title = post.listing?.title ?? (post.facts && typeof post.facts === "object" && "headline" in post.facts ? String((post.facts as { headline: unknown }).headline) : null) ?? KIND_LABEL[post.kind] ?? "Post";

  async function run(label: string, fn: () => Promise<unknown>, done?: string) {
    setBusy(label);
    try {
      await fn();
      if (done) showAlert(done, "success");
    } catch (err) {
      showError(err);
      throw err;
    } finally {
      setBusy(null);
    }
  }

  const save = () =>
    run("save", async () => {
      await update({ id: post.id, captions: captionsForSave(draft ?? {}) });
      setDraft(null);
    }, actions.editResets ? "Saved. The post is back in Waiting." : "Saved.").catch(() => {});

  const goesTo = networks.map((n) => NETWORK_LABEL[n]).join(", ") || "no network yet";

  return (
    <article className="st-card st-in" data-pinned={pinned || undefined} data-busy={busy !== null && busy !== "save" ? "true" : undefined} id={`post-${post.id}`}>
      <div className="st-card-head">
        <div style={{ minWidth: 0 }}>
          <p className="st-eyebrow">
            <span>{KIND_LABEL[post.kind] ?? post.kind}</span>
            <span aria-hidden="true">·</span>
            <span className="st-tnum">{relativeTime(post.createdAt, now)}</span>
          </p>
          <h3 className="st-card-title">{title}</h3>
        </div>
        <div className="st-row" style={{ justifyContent: "end", flexShrink: 0 }}>
          {story && <span className="st-badge">Story</span>}
          {actions.publishing ? (
            <span className="st-badge" data-tone="blue">
              <span className="st-dot" data-tone="live" style={{ background: "#fff" }} aria-hidden="true" />
              Publishing
            </span>
          ) : (
            <span className="st-badge" data-tone={STATUS_TONE[post.status]}>
              {STATUS_LABEL[post.status] ?? post.status}
            </span>
          )}
          {pinned && onClosePin && (
            <button type="button" className="st-icon-btn" aria-label="Close this post" onClick={onClosePin}>
              ×
            </button>
          )}
        </div>
      </div>

      {post.scheduledFor && (post.status === "scheduled" || post.status === "waiting") && (
        <p className="st-note st-tnum">
          {post.status === "scheduled" ? "Goes out" : "Publish time"} {formatTbilisi(post.scheduledFor, now)} · {relativeTime(post.scheduledFor, now)}
        </p>
      )}

      {post.media.length > 0 && <MediaStrip media={post.media} story={story} />}

      {actions.edit ? (
        <div className="st-stack">
          {story ? (
            <StoryNetworks value={captions} onChange={setDraft} label={post.listing?.title ?? "Story"} disabled={busy !== null} />
          ) : (
            <CaptionEditor value={captions} onChange={setDraft} disabled={busy !== null} />
          )}
          {dirty && (
            <div className="st-callout" data-tone="blue">
              <span style={{ flex: 1 }}>{actions.editResets ? "Saving sends this post back to Waiting (a schedule is cancelled)." : "Unsaved changes."}</span>
            </div>
          )}
          {dirty && (
            <div className="st-actions">
              <button type="button" className="st-btn st-btn-ghost st-btn-sm" onClick={() => setDraft(null)} disabled={busy !== null}>
                Discard
              </button>
              <button type="button" className="st-btn st-btn-sm" onClick={save} disabled={busy !== null || !captionsFit(captions)} data-busy={busy === "save"}>
                Save captions
              </button>
            </div>
          )}
        </div>
      ) : (
        <ReadOnlyCaptions captions={post.captions} story={story} />
      )}

      {post.results.length > 0 && <Results results={post.results} />}
      {post.error && <p className="st-callout">{post.error}</p>}
      {post.note && post.status === "rejected" && <p className="st-note">Note: {post.note}</p>}

      <Actions
        actions={actions}
        dirty={dirty}
        busy={busy}
        onPublish={() => setSheet("publish")}
        onSchedule={() => setSheet("schedule")}
        onReject={() => setSheet("reject")}
        onUnschedule={() => run("unschedule", () => unschedule({ id: post.id }), "Unscheduled: back in Waiting.").catch(() => {})}
        onRetry={() => run("retry", () => retry({ id: post.id }), "Publishing the networks that didn't go out.").catch(() => {})}
      />

      <ConfirmSheet
        open={sheet === "publish"}
        onClose={() => setSheet(null)}
        title="Publish now?"
        tone="blue"
        confirmLabel="Publish now"
        body={
          <>
            It goes out right away {story ? "as a story " : ""}to <strong>{goesTo}</strong>. Networks without a connected account are skipped.
          </>
        }
        onConfirm={() => run("publish", () => publish({ id: post.id }), "Publishing.")}
      />
      <TimeSheet
        open={sheet === "schedule"}
        onClose={() => setSheet(null)}
        title={post.status === "scheduled" ? "Move the time" : "Schedule"}
        confirmLabel="Schedule"
        initial={post.scheduledFor}
        intro={<>Goes out {story ? "as a story " : ""}to <strong>{goesTo}</strong> at this time.</>}
        onPick={(at) => run("schedule", () => publish({ id: post.id, at }), `Scheduled for ${formatTbilisi(at)}.`)}
      />
      <RejectSheet open={sheet === "reject"} onClose={() => setSheet(null)} onReject={(note) => run("reject", () => reject({ id: post.id, note: note || undefined }), "Rejected.")} />
    </article>
  );
}

function Actions({
  actions,
  dirty,
  busy,
  onPublish,
  onSchedule,
  onUnschedule,
  onReject,
  onRetry,
}: {
  actions: ReturnType<typeof postActions>;
  dirty: boolean;
  busy: string | null;
  onPublish: () => void;
  onSchedule: () => void;
  onUnschedule: () => void;
  onReject: () => void;
  onRetry: () => void;
}) {
  if (actions.publishing) return <p className="st-note">Publishing now. This can take a few minutes for videos; the results show here.</p>;
  const any = actions.publishNow || actions.schedule || actions.unschedule || actions.retry || actions.reject;
  if (!any) return null;
  const off = busy !== null || dirty;
  return (
    <div className="st-stack" style={{ gap: 8 }}>
      {dirty && <p className="st-note">Save or discard the caption edits first.</p>}
      <div className="st-actions">
        {actions.publishNow && (
          <button type="button" className="st-btn st-btn-blue" onClick={onPublish} disabled={off} data-busy={busy === "publish"}>
            Publish now
          </button>
        )}
        {actions.schedule && (
          <button type="button" className="st-btn" onClick={onSchedule} disabled={off} data-busy={busy === "schedule"}>
            {actions.unschedule ? "Move time" : "Schedule"}
          </button>
        )}
        {actions.retry && (
          <button type="button" className="st-btn st-btn-blue" onClick={onRetry} disabled={off} data-busy={busy === "retry"}>
            Retry
          </button>
        )}
        {actions.unschedule && (
          <button type="button" className="st-btn st-btn-ghost" onClick={onUnschedule} disabled={off} data-busy={busy === "unschedule"}>
            Unschedule
          </button>
        )}
        {actions.reject && (
          <button type="button" className="st-btn st-btn-ghost" onClick={onReject} disabled={busy !== null} data-busy={busy === "reject"}>
            Reject
          </button>
        )}
      </div>
    </div>
  );
}

function MediaStrip({ media, story }: { media: Post["media"]; story: boolean }) {
  return (
    <div className="st-media" aria-label={`${media.length} media`}>
      {media.map((m, i) => (
        <a key={`${m.url}-${i}`} href={m.url} target="_blank" rel="noopener noreferrer" className="st-media-item" data-ratio={story ? "story" : undefined} aria-label={`Open ${m.kind} ${i + 1}`}>
          {m.kind === "video" ? <video src={m.url} muted playsInline preload="metadata" /> : <img src={m.url} alt="" loading="lazy" decoding="async" />}
          {(m.kind === "video" || (m.role && m.role !== "screenshot")) && <span className="st-media-kind">{m.kind === "video" ? "Video" : m.role}</span>}
        </a>
      ))}
    </div>
  );
}

function ReadOnlyCaptions({ captions, story }: { captions: Captions; story: boolean }) {
  const networks = captionedNetworks(captions);
  if (networks.length === 0) return null;
  if (story) return <p className="st-note">Story on {networks.map((n) => NETWORK_LABEL[n]).join(" and ")}.</p>;
  return (
    <details className="st-stack">
      <summary className="st-link" style={{ cursor: "pointer" }}>
        Captions ({networks.map((n) => NETWORK_LABEL[n]).join(", ")})
      </summary>
      {networks.map((n) => (
        <div key={n} className="st-field">
          <span className="st-label">{NETWORK_LABEL[n]}</span>
          <p style={{ whiteSpace: "pre-wrap", fontSize: 14, lineHeight: 1.5 }}>{captions[n]}</p>
        </div>
      ))}
    </details>
  );
}

const RESULT_TONE: Record<Result["status"], "ink" | "mute" | undefined> = { sent: "ink", failed: undefined, skipped: "mute" };

function Results({ results }: { results: Result[] }) {
  return (
    <ul className="st-results" aria-label="Results per network">
      {results.map((r) => (
        <li key={r.network}>
          <span className="st-results-net">{NETWORK_LABEL[r.network as Network]}</span>
          <span className="st-badge" data-tone={RESULT_TONE[r.status]}>
            {r.status}
          </span>
          <span className="st-results-msg">{r.error ?? r.note ?? ""}</span>
          {r.url && (
            <a className="st-link" href={r.url} target="_blank" rel="noopener noreferrer">
              View <ArrowIcon size={14} />
            </a>
          )}
        </li>
      ))}
    </ul>
  );
}
