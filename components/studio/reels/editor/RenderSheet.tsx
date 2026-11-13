"use client";

import { memo, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { useAction, useConvex, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { showAlert } from "@/components/admin/Alerts";
import { render, renderSupport, uploadRender, type RenderSupport } from "@/lib/reel/render";
import { recipeListingIds, type ReelRecipe } from "@/lib/reel/recipe";
import { captionsForSave } from "@/lib/studio/captions";
import { recipeKey, storyFits, formatSec } from "@/lib/studio/reelEditor";
import { reelCaptions } from "@/lib/studio/reelPost";
import { isCancelled, reelRenders, type RenderJobState, type RenderedReel } from "@/lib/studio/reelRender";
import { storefrontSiteUrl } from "@/lib/storefront";
import { useNow } from "../../hooks";
import { ConfirmSheet, Sheet, SheetError } from "../../ui";
import { RenderIcon } from "./icons";

// Render: the reel made in this browser (lib/reel/render.ts: the same
// compositor as the preview), uploaded to R2 and kept as media with its full
// recipe so it can be edited again. Then: use it in a post (new reel or story),
// or put it in the post it was opened from. Nothing is published here: a post
// waits in the queue until it is approved.

const IDLE: RenderJobState = { running: null, stage: null };
const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
const EDITABLE = new Set(["waiting", "approved", "scheduled", "failed"]);
const BACK_TO_WAITING = new Set(["approved", "scheduled", "failed"]);

type Props = {
  open: boolean;
  onClose: () => void;
  recipe: ReelRecipe;
  title: string;
  /** Where the render is kept on this device: the draft id, or "new". */
  jobKey: string;
  problems: string[];
  /** Saves pending edits (creating the draft when needed); the draft id and its updatedAt, or throws. */
  ensureSaved: () => Promise<{ id: Id<"reelDrafts">; updatedAt: number }>;
  post?: { id: Id<"socialPosts">; item: number | null } | null;
};

export const RenderSheet = memo(function RenderSheet({ open, onClose, recipe, title, jobKey, problems, ensureSaved, post }: Props) {
  const router = useRouter();
  const job = useSyncExternalStore(reelRenders.subscribe, reelRenders.get, () => IDLE);
  const renderUploadUrl = useAction(api.reels.renderUploadUrl);
  const registerRender = useMutation(api.reels.registerRender);
  const createPost = useMutation(api.social.create);
  const updatePost = useMutation(api.social.update);
  // Read from the start (not only when the sheet opens): the post as it was when the editor opened is what "Replace" changes.
  const target = useQuery(api.social.get, post ? { id: post.id } : "skip");
  const opened = useRef<string[] | null>(null);
  if (target && opened.current === null) opened.current = target.media.map((m) => m.url);
  const listingIds = recipeListingIds(recipe);
  const convex = useConvex();
  const [support, setSupport] = useState<RenderSupport | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [acting, setActing] = useState<string | null>(null);
  const [confirmReplace, setConfirmReplace] = useState(false);
  const now = useNow(5_000);

  useEffect(() => {
    if (!open || support) return;
    let live = true;
    renderSupport().then(
      (s) => live && setSupport(s),
      () => live && setSupport({ ok: false, reason: "This browser can't make videos. Open the Studio in Chrome or Edge on a computer." }),
    );
    return () => {
      live = false;
    };
  }, [open, support]);

  const key = useMemo(() => recipeKey(recipe), [recipe]);
  const done: RenderedReel | null = reelRenders.done(jobKey);
  const current = done?.recipeKey === key;
  const running = job.running === jobKey;
  const busyElsewhere = job.running !== null && !running;

  async function start() {
    setError(null);
    try {
      const saved = await ensureSaved();
      const snapshot = recipe;
      const out = await reelRenders.run(saved.id, key, async (report, signal) => {
        const reel = await render(snapshot, (p) => report({ label: p.stage, fraction: p.fraction * 0.88 }), signal);
        const size = reel.blob.size;
        const uploading = `Uploading ${mb(size)}`;
        report({ label: uploading, fraction: 0.9 });
        const { uploadUrl, key: fileKey } = await renderUploadUrl({ size, draftId: saved.id });
        if (signal.aborted) throw Object.assign(new Error("Cancelled."), { code: "cancelled" });
        try {
          await uploadRender(reel.blob, uploadUrl, { signal, onProgress: (f) => report({ label: uploading, fraction: 0.9 + 0.07 * f }) });
        } catch (err) {
          if (signal.aborted) throw Object.assign(new Error("Cancelled."), { code: "cancelled" });
          throw err;
        }
        // The file is stored now: it is registered even when Cancel came late, so no file is left without its media row.
        report({ label: "Finishing", fraction: 0.97 });
        const reg = await registerRender({
          key: fileKey,
          size: reel.blob.size,
          width: reel.width,
          height: reel.height,
          durationSec: reel.durationSec,
          recipe: snapshot,
          draftId: saved.id,
          draftUpdatedAt: saved.updatedAt,
        });
        return { url: reg.url, mediaId: reg.mediaId, width: reel.width, height: reel.height, durationSec: reel.durationSec, size: reel.blob.size };
      });
      if (out) showAlert("Reel rendered and saved.", "success");
    } catch (err) {
      if (isCancelled(err)) return;
      setError(err);
    }
  }

  /** A new waiting post with this reel (feed reel or story), opened in the queue. */
  async function newPost(placement: "feed" | "story") {
    if (!done) return;
    setActing(placement);
    setError(null);
    try {
      // Every listing in the reel (a fusion of several gets one post naming them all).
      const found = await Promise.all(listingIds.slice(0, 6).map((id) => convex.query(api.reels.listingSources, { listingId: id as Id<"listings"> })));
      const listings = found.filter((l): l is NonNullable<typeof l> => !!l);
      const l = listings.length === 1 ? listings[0] : null;
      const captions = reelCaptions(listings, placement, title, storefrontSiteUrl);
      const created = await createPost({
        kind: "custom",
        listingId: l ? l.id : undefined,
        captions: captionsForSave(captions),
        media: [{ kind: "video", url: done.url, role: "reel" }],
        placement,
      });
      router.push(`/queue?post=${created.id}`);
    } catch (err) {
      setError(err);
      setActing(null);
    }
  }

  /**
   * The post this editor was opened from: the reel replaces the video that was
   * item `post.item` when the editor opened (found by its URL), or is added.
   * The post's media as it was then goes as baseMedia, so a post that changed
   * meanwhile is refused instead of the wrong item being replaced.
   */
  async function intoPost() {
    if (!done || !post || !target) return;
    setActing("post");
    setError(null);
    try {
      const base = opened.current ?? target.media.map((m) => m.url);
      const media = target.media.map((m) => ({ ...m }));
      const item = { kind: "video" as const, url: done.url, role: "reel" };
      const fromUrl = post.item !== null ? base[post.item] : undefined;
      const at = fromUrl ? media.findIndex((m) => m.url === fromUrl && m.kind === "video") : -1;
      if (at >= 0) {
        const old = media[at];
        media[at] = old.networks ? { ...item, networks: old.networks } : item;
      } else if (!media.some((m) => m.url === done.url)) media.push(item);
      await updatePost({ id: post.id, media, baseMedia: base });
      router.replace(`/queue?post=${post.id}`);
    } catch (err) {
      setError(err);
      setActing(null);
      throw err;
    }
  }

  const replacing = post?.item !== null && post?.item !== undefined;
  const postEditable = target ? EDITABLE.has(target.status) && !(target.publishingUntil && target.publishingUntil > now) : false;
  const canStory = done ? storyFits(recipe.reel.aspect, done.durationSec) && current : false;
  const fraction = job.stage?.fraction;

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Render"
      subtitle={title || "New reel"}
      footer={
        running ? (
          <button type="button" className="st-btn st-btn-ghost" onClick={() => reelRenders.cancel()}>
            Cancel render
          </button>
        ) : (
          <>
            <button type="button" className="st-btn st-btn-ghost" onClick={onClose}>
              Close
            </button>
            <button type="button" className={`st-btn${done && current ? " st-btn-ghost" : ""}`} onClick={start} disabled={!support?.ok || problems.length > 0 || busyElsewhere}>
              <RenderIcon size={18} />
              {done ? "Render again" : "Render"}
            </button>
          </>
        )
      }
    >
      {/* Screen readers hear the stage, not every percent. */}
      <p className="st-re-sr" role="status" aria-live="polite">
        {running && job.stage ? job.stage.label.replace(/ [\d.]+ MB$/, "") : ""}
      </p>
      {open && support === null && <p className="st-note">Checking this browser…</p>}
      {support && !support.ok && (
        <p className="st-callout" data-tone="error" role="alert">
          {support.reason}
        </p>
      )}
      {problems.length > 0 && (
        <div className="st-callout" data-tone="error" role="alert">
          <ul className="st-re-problems">
            {problems.slice(0, 6).map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
      )}
      {busyElsewhere && <p className="st-note">Another reel is rendering. This one can render when it is done.</p>}

      {running && job.stage && (
        <div className="st-inset st-re-busy">
          <div className="st-progress" data-indeterminate={fraction === undefined}>
            <span style={fraction !== undefined ? { width: `${Math.round(fraction * 100)}%` } : undefined} />
          </div>
          <p className="st-note st-tnum">
            {job.stage.label}
            {fraction !== undefined ? ` ${Math.round(fraction * 100)}%` : "…"}
          </p>
          <p className="st-note">Keep this tab open. You can leave the editor; it carries on.</p>
        </div>
      )}

      {!running && !done && support?.ok && problems.length === 0 && (
        <p className="st-note">
          Makes an MP4 ({recipe.reel.aspect}, 30 fps, H.264 and AAC) in this browser, exactly as the preview shows, and saves it. Nothing is posted.
        </p>
      )}

      {done && !running && (
        <div className="st-re-done">
          <div className="st-re-done-frame" style={{ aspectRatio: `${done.width} / ${done.height}` }}>
            <video src={done.url} controls playsInline preload="metadata" />
          </div>
          <p className="st-note st-tnum">
            {formatSec(done.durationSec)} · {mb(done.size)} · {done.width}×{done.height}
            {!current && " · made from an earlier version of this reel"}
          </p>

          {post && (
            <div className="st-re-done-post">
              <button
                type="button"
                className="st-btn st-btn-block"
                disabled={!target || !postEditable || acting !== null}
                data-busy={acting === "post"}
                onClick={() => (target && BACK_TO_WAITING.has(target.status) ? setConfirmReplace(true) : void intoPost().catch(() => {}))}
              >
                {replacing ? "Replace in post" : "Add to post"}
              </button>
              {target && !postEditable && <p className="st-note">That post can&apos;t change now (it is {target.status}).</p>}
            </div>
          )}
          <div className="st-actions">
            <button type="button" className={`st-btn${post ? " st-btn-ghost" : ""}`} onClick={() => newPost("feed")} disabled={acting !== null} data-busy={acting === "feed"}>
              Post as reel
            </button>
            <button type="button" className="st-btn st-btn-ghost" onClick={() => newPost("story")} disabled={acting !== null || !canStory} data-busy={acting === "story"}>
              Post as story
            </button>
          </div>
          {!canStory && <p className="st-note">A story takes a 9:16 reel of 3 to 60 s{current ? "" : ", rendered from this version"}.</p>}
          <p className="st-note">A new post waits in the queue with draft captions. Nothing goes out until you approve it.</p>
        </div>
      )}

      <SheetError error={error} />

      <ConfirmSheet
        open={confirmReplace}
        onClose={() => setConfirmReplace(false)}
        title={replacing ? "Replace in this post?" : "Add to this post?"}
        confirmLabel={replacing ? "Replace" : "Add"}
        body="This post goes back to Waiting. You approve it again after."
        onConfirm={intoPost}
      />
    </Sheet>
  );
});
