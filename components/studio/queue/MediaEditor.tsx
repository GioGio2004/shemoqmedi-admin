"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { showAlert, showError } from "@/components/admin/Alerts";
import { editResetText as resetText } from "@/lib/studio/postEdit";
import type { PostActions } from "@/lib/studio/queue";
import { draftMadeFromVideo, newReelHref, reelAction, reelEditorHref, reelOffers, recipeFromVideo, reelTitleFor } from "@/lib/studio/reelPost";
import { useMedia } from "../hooks";
import { AlertIcon, PlusIcon, ReelIcon, TrashIcon } from "../icons";
import { Lightbox } from "../Lightbox";
import { ikUrl } from "../media";
import { ConfirmSheet, Segmented, SheetError, Skel } from "../ui";
import { EarlierGlyph, GripGlyph, LaterGlyph, PlayGlyph } from "./glyphs";
import {
  addHref,
  addProblem,
  appendItems,
  carouselSet,
  cleanItem,
  editHref,
  editLabel,
  itemKeys,
  itemNotes,
  itemTitle,
  moveItem,
  optimisticDetail,
  removeItem,
  removeNote,
  replaceItem,
  storySwitch,
  type MediaItem,
  type Picked,
  type PostDetailData,
} from "./mediaEdit";
import { PickSheet, type PickMode } from "./PickSheet";
import { ReelOffers } from "./ReelOffers";

type Edit = { media?: MediaItem[]; placement?: "feed" | "story" };
type Ask = { title: string; body: ReactNode; label: string; edit: Edit; base: string[]; picked: Picked[]; done: string };

/** Sizes and recipes of the files being saved, by URL, for the optimistic copy of the post (known before the server answers). */
const saving = new Map<string, Picked>();

/**
 * The post sheet's media editor (docs/post-editing.md): each image or video
 * with Open, Edit design (Create in edit mode), Edit reel / Make a reel (the
 * reel editor, docs/reel-editor.md section 6), Replace, Move earlier / later
 * (or drag, with a mouse), Remove; Add: a new design, a new reel, listing
 * screenshots, recent renders or an image from the device; renders of this
 * post's reels that aren't in it yet; the Feed / Story switch. Every
 * change saves at once through social.update with the whole media list (and
 * the list it was made from, so an edit over a newer version is refused),
 * shown at once (optimistic). A change to an approved, scheduled or failed
 * post sends it back to Waiting: asked first. Returns the section for the
 * sheet's body and the sheets it opens (rendered beside the post sheet, not
 * inside it).
 */
export function useMediaEditor({ detail, actions, title, locked }: { detail: PostDetailData | undefined; actions: PostActions; title: string; locked: boolean }) {
  const uid = useId();
  const update = useMutation(api.social.update).withOptimisticUpdate((store, args) => {
    const cur = store.getQuery(api.social.get, { id: args.id });
    if (!cur) return;
    const next = optimisticDetail(cur, { media: args.media, placement: args.placement }, [...saving.values()]);
    store.setQuery(api.social.get, { id: args.id }, next);
    for (const { args: qa, value } of store.getAllQueries(api.social.queue)) {
      if (!value?.some((p) => p.id === args.id)) continue;
      store.setQuery(
        api.social.queue,
        qa,
        value.map((p) => (p.id === args.id ? { ...p, media: next.media, placement: next.placement } : p)),
      );
    }
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [ask, setAsk] = useState<Ask | null>(null);
  const [pick, setPickState] = useState<{ open: boolean; mode: PickMode }>({ open: false, mode: { type: "add" } });
  const setPick = (mode: PickMode | null) => setPickState((p) => (mode ? { open: true, mode } : { ...p, open: false }));
  const [viewer, setViewer] = useState<{ index: number; el: HTMLElement } | null>(null);
  const [drag, setDrag] = useState<{ from: number; over: number } | null>(null);
  const thumbs = useRef(new Map<number, HTMLElement>());
  // Move buttons by item key ("<key> earlier" / "<key> later"), and where focus goes once a move or remove is saved.
  const moveBtns = useRef(new Map<string, HTMLButtonElement>());
  const refocus = useRef<{ type: "move"; key: string; dir: "earlier" | "later" } | { type: "remove"; index: number } | null>(null);
  const mouse = useMedia("(pointer: fine)");
  const router = useRouter();
  const openFromMedia = useMutation(api.reels.openFromMedia);
  const createReel = useMutation(api.reels.create);
  // Reel drafts, to offer renders made for this post (or of its reels) that aren't in it yet.
  const drafts = useQuery(api.reels.list, actions.edit && detail ? { limit: 100 } : "skip");
  // The item whose reel is opening in the editor (a draft is found or made first).
  const [opening, setOpening] = useState<number | null>(null);

  const editable = actions.edit && !!detail;
  const off = locked || busy || opening !== null;

  /** Saves the edit; throws (after showing it) so a confirm sheet stays open with the reason. */
  async function apply(edit: Edit, base: string[], picked: Picked[], done: string) {
    if (!detail) return;
    setBusy(true);
    setError(null);
    setHint(null);
    for (const p of picked) saving.set(p.url, p);
    try {
      await update({ id: detail.id, ...edit, baseMedia: base });
      showAlert(actions.editResets ? `${done} The post is back in Waiting.` : done, "success");
    } catch (err) {
      showError(err);
      setError(err);
      throw err;
    } finally {
      for (const p of picked) saving.delete(p.url);
      setBusy(false);
    }
  }

  /** A change: asked first when it is destructive (`confirm`) or sends the post back to waiting. `picked`: what new items are, for the optimistic copy. */
  function change(edit: Edit, done: string, confirm?: { title: string; body: ReactNode; label: string }, picked: Picked[] = []) {
    if (!detail) return;
    // The media the edit was made from: refused by the server if the post changed meanwhile.
    const base = detail.media.map((m) => m.url);
    if (confirm || actions.editResets) {
      const reset = actions.editResets ? resetText(detail.status) : null;
      setAsk({
        title: confirm?.title ?? "Back to Waiting?",
        body: (
          <>
            {confirm?.body}
            {confirm?.body && reset ? " " : null}
            {reset}
          </>
        ),
        label: confirm?.label ?? "Save",
        edit,
        base,
        picked,
        done,
      });
      return;
    }
    apply(edit, base, picked, done).catch(() => {});
  }

  const media = detail?.media ?? [];
  const details = detail?.mediaDetails ?? [];
  const story = detail?.placement === "story";
  const instagram = !!detail?.captions.instagram?.trim();
  const tooMany = detail ? addProblem(media.length, story) : null;
  const keys = itemKeys(media);
  const offers = detail && actions.edit ? reelOffers(detail.id, media, details, drafts) : [];

  /**
   * Edit reel: the draft behind this reel (or a new one from its recipe);
   * Make a reel: the draft already made from this video for this post, else a
   * new draft with this video as its one clip. Then the reel
   * editor, from this post and item: its render can replace this item.
   */
  async function openReel(i: number) {
    if (!detail || off) return;
    const m = media[i];
    const d = details[i];
    const act = reelAction(m, d);
    if (!act) return;
    setOpening(i);
    setError(null);
    try {
      let id: Id<"reelDrafts"> | null;
      if (act.type === "edit") {
        id = await openFromMedia({ url: m.url, postId: detail.id });
        if (!id) throw new Error("This video has no reel recipe now. Use Make a reel instead.");
      } else {
        id =
          draftMadeFromVideo(drafts, detail.id, m.url)?.id ??
          (await createReel({ recipe: recipeFromVideo(m, d, detail), title: reelTitleFor(detail), postId: detail.id })).id;
      }
      router.push(reelEditorHref(id, { postId: detail.id, item: i }));
    } catch (err) {
      showError(err);
      setError(err);
      setOpening(null);
    }
  }

  // Keyboard and screen-reader focus stays with the item that moved (or the next one after a remove), once the buttons are enabled again.
  useEffect(() => {
    const f = refocus.current;
    if (!f || busy || ask) return;
    refocus.current = null;
    if (f.type === "remove") {
      thumbs.current.get(Math.min(f.index, media.length - 1))?.focus();
      return;
    }
    const at = keys.indexOf(f.key);
    if (at < 0) return;
    const dir = f.dir === "earlier" ? (at === 0 ? "later" : "earlier") : at === media.length - 1 ? "earlier" : "later";
    moveBtns.current.get(`${f.key} ${dir}`)?.focus();
  });

  function move(from: number, to: number, dir?: "earlier" | "later") {
    if (from === to || to < 0 || to >= media.length) return;
    if (dir) refocus.current = { type: "move", key: keys[from], dir };
    change({ media: moveItem(media.map(cleanItem), from, to) }, `Moved to place ${to + 1}.`);
  }

  function remove(i: number) {
    const last = media.length === 1;
    refocus.current = { type: "remove", index: i };
    change({ media: removeItem(media.map(cleanItem), i) }, "Removed.", {
      title: `Remove ${itemTitle(media[i], details[i]).toLowerCase()}?`,
      body: last ? (story ? "The story has no picture until you add one." : "The post has no picture left; Instagram needs one.") : removeNote(media[i], details[i], !!detail?.listing),
      label: "Remove",
    });
  }

  function placement(next: "feed" | "story") {
    if (!detail || next === detail.placement) return;
    if (next === "feed") {
      change({ placement: "feed" }, "Now a feed post.");
      return;
    }
    const s = storySwitch(media, details);
    if (s.type === "no") {
      setHint(s.reason);
      return;
    }
    if (s.type === "pick") {
      change({ placement: "story", media: s.media }, "Now a story.", {
        title: "Make it a story?",
        body: `A story is one 9:16 picture: item ${s.index + 1} stays and the other ${s.drops} ${s.drops === 1 ? "is" : "are"} removed.`,
        label: "Make it a story",
      });
      return;
    }
    change(s.media.length === media.length ? { placement: "story" } : { placement: "story", media: s.media }, "Now a story.");
  }

  // From the pick sheet, which says when the post goes back to Waiting (its Add / Replace is the yes).
  async function picked(mode: PickMode, items: Picked[]) {
    if (!items.length || !detail) return;
    const base = detail.media.map((m) => m.url);
    if (mode.type === "replace") await apply({ media: replaceItem(media, mode.index, items[0]) }, base, items, "Replaced.");
    else await apply({ media: appendItems(media, items) }, base, items, items.length === 1 ? "Added." : `Added ${items.length}.`);
    setPick(null);
  }

  const noLink = (e: React.MouseEvent) => {
    if (off) e.preventDefault();
  };

  const section = !actions.edit ? null : (
    <section className="st-queue-sec" aria-labelledby={`${uid}-h`}>
      <div className="st-sec-head">
        <h3 className="st-h3" id={`${uid}-h`}>
          Media
          {detail && <span className="st-qm-count st-tnum">{`${media.length} of ${story ? 1 : 10}`}</span>}
        </h3>
        {detail && (
          <Segmented
            kind="radio"
            size="sm"
            label="Where it shows"
            value={detail.placement}
            onChange={placement}
            options={[
              { value: "feed", label: "Feed", disabled: off },
              { value: "story", label: "Story", disabled: off },
            ]}
          />
        )}
      </div>

      <SheetError error={error} />
      {hint && (
        <p className="st-callout" role="status">
          <AlertIcon size={18} />
          <span>{hint}</span>
        </p>
      )}
      {detail?.instagramProblem && !story && (
        <p className="st-callout" data-tone="error">
          <AlertIcon size={18} />
          <span>{detail.instagramProblem} Approval refuses it until this is fixed.</span>
        </p>
      )}

      {!detail ? (
        <div className="st-inset st-qm-list" aria-hidden="true">
          <div className="st-qm-item">
            <Skel className="st-qm-thumb" />
            <Skel className="st-skel-text" />
          </div>
        </div>
      ) : media.length === 0 ? (
        <p className="st-note">{story ? "No picture yet: add one 9:16 image or video." : "No pictures yet. Add a design, screenshots or an image."}</p>
      ) : (
        <ol className="st-inset st-qm-list" aria-label="Media in posting order" aria-busy={busy || undefined}>
          {media.map((m, i) => {
            const d = details[i];
            const name = itemTitle(m, d);
            const notes = itemNotes(m, d, { instagram, story });
            const label = editLabel(m, d);
            const reel = reelAction(m, d);
            const set = d?.design?.kind === "carousel" ? carouselSet(details, i).length : 0;
            const dragging = drag?.from === i;
            const over = drag && drag.over === i && drag.from !== i ? (drag.from < i ? "after" : "before") : undefined;
            return (
              <li
                key={keys[i]}
                className="st-qm-item"
                data-drag={dragging || undefined}
                data-over={over}
                draggable={mouse && !off && media.length > 1}
                onDragStart={(e) => {
                  e.dataTransfer.effectAllowed = "move";
                  e.dataTransfer.setData("text/plain", String(i));
                  setDrag({ from: i, over: i });
                }}
                onDragOver={(e) => {
                  if (!drag) return;
                  e.preventDefault();
                  if (drag.over !== i) setDrag({ ...drag, over: i });
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  if (drag) move(drag.from, i);
                  setDrag(null);
                }}
                onDragEnd={() => setDrag(null)}
              >
                <button
                  type="button"
                  className="st-qm-thumb"
                  ref={(el) => {
                    if (el) thumbs.current.set(i, el);
                    else thumbs.current.delete(i);
                  }}
                  onClick={(e) => setViewer({ index: i, el: e.currentTarget })}
                  aria-label={`Open item ${i + 1}: ${name}`}
                >
                  {m.kind === "video" ? (
                    <>
                      <video src={m.url} muted playsInline preload="metadata" />
                      <span className="st-qm-play" aria-hidden="true">
                        <PlayGlyph size={16} />
                      </span>
                    </>
                  ) : (
                    <img src={ikUrl(m.url, 200)} alt="" draggable={false} decoding="async" />
                  )}
                </button>
                <div className="st-qm-tx">
                  <b>
                    <span className="st-tnum">{i + 1}.</span> {name}
                  </b>
                  {notes.length > 0 && <small>{notes.join(" · ")}</small>}
                </div>
                {mouse && media.length > 1 && (
                  <span className="st-qm-grip" aria-hidden="true" title="Drag to move">
                    <GripGlyph size={18} />
                  </span>
                )}
                <div className="st-qm-acts">
                  {reel && (
                    <button type="button" className="st-btn st-btn-ghost st-btn-sm" onClick={() => openReel(i)} disabled={off} data-busy={opening === i || undefined}>
                      {reel.label}
                    </button>
                  )}
                  {label && (
                    <Link
                      className="st-btn st-btn-ghost st-btn-sm"
                      href={editHref(detail.id, i)}
                      onClick={noLink}
                      aria-disabled={off || undefined}
                      aria-label={set > 1 ? `${label}: all ${set} slides` : undefined}
                    >
                      {label}
                    </Link>
                  )}
                  <button type="button" className="st-btn st-btn-ghost st-btn-sm" onClick={() => setPick({ type: "replace", index: i })} disabled={off}>
                    Replace
                  </button>
                  <span className="st-qm-moves">
                    <button
                      type="button"
                      className="st-icon-btn is-plain"
                      ref={(el) => {
                        if (el) moveBtns.current.set(`${keys[i]} earlier`, el);
                        else moveBtns.current.delete(`${keys[i]} earlier`);
                      }}
                      onClick={() => move(i, i - 1, "earlier")}
                      disabled={off || i === 0}
                      aria-label={`Move ${i + 1} earlier`}
                    >
                      <EarlierGlyph size={20} />
                    </button>
                    <button
                      type="button"
                      className="st-icon-btn is-plain"
                      ref={(el) => {
                        if (el) moveBtns.current.set(`${keys[i]} later`, el);
                        else moveBtns.current.delete(`${keys[i]} later`);
                      }}
                      onClick={() => move(i, i + 1, "later")}
                      disabled={off || i === media.length - 1}
                      aria-label={`Move ${i + 1} later`}
                    >
                      <LaterGlyph size={20} />
                    </button>
                    <button type="button" className="st-icon-btn is-plain st-qm-remove" onClick={() => remove(i)} disabled={off} aria-label={`Remove ${i + 1}`}>
                      <TrashIcon size={20} />
                    </button>
                  </span>
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {detail && offers.length > 0 && (
        <ReelOffers
          offers={offers}
          count={media.length}
          story={story}
          off={off}
          onReplace={(index, pick) => change({ media: replaceItem(media, index, pick) }, "Replaced with the new render.", undefined, [pick])}
          onAdd={(pick) => change({ media: appendItems(media, [pick]) }, "Reel added.", undefined, [pick])}
        />
      )}

      {detail && (
        <div className="st-qm-add">
          {tooMany ? (
            <p className="st-note">{tooMany}</p>
          ) : (
            <>
              <Link className="st-btn st-btn-ghost st-btn-sm" href={addHref(detail.id)} onClick={noLink} aria-disabled={off || undefined}>
                <PlusIcon size={17} /> New design
              </Link>
              <Link className="st-btn st-btn-ghost st-btn-sm" href={newReelHref(detail.id)} onClick={noLink} aria-disabled={off || undefined}>
                <ReelIcon size={17} /> New reel
              </Link>
              <button type="button" className="st-btn st-btn-ghost st-btn-sm" onClick={() => setPick({ type: "add" })} disabled={off}>
                Add images
              </button>
            </>
          )}
        </div>
      )}
      {actions.editResets && <p className="st-note">A change here sends this post back to Waiting (a schedule is cancelled).</p>}
    </section>
  );

  const sheets = (
    <>
      <ConfirmSheet
        open={ask !== null}
        onClose={() => setAsk(null)}
        title={ask?.title ?? ""}
        body={ask?.body ?? null}
        confirmLabel={ask?.label ?? "Save"}
        onConfirm={() => (ask ? apply(ask.edit, ask.base, ask.picked, ask.done) : undefined)}
      />
      {detail && (
        <PickSheet
          open={pick.open}
          mode={pick.mode}
          post={detail}
          title={title}
          resets={actions.editResets ? resetText(detail.status) : null}
          onClose={() => setPick(null)}
          onPick={(items) => picked(pick.mode, items)}
        />
      )}
      {viewer && detail && (
        <Lightbox
          items={media.map((m, i) => ({ url: m.url, kind: m.kind, w: details[i]?.width ?? undefined, h: details[i]?.height ?? undefined }))}
          start={viewer.index}
          origin={viewer.el}
          originFor={(i) => thumbs.current.get(i) ?? null}
          label={title}
          onClose={() => setViewer(null)}
        />
      )}
    </>
  );

  return { section, sheets, editable };
}
