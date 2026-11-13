"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { showAlert, showError } from "@/components/admin/Alerts";
import { draftLine, reelPick, type ReelOffer, type ReelPick } from "@/lib/studio/reelPost";
import { addProblem, storyItemProblem } from "./mediaEdit";

/**
 * Renders that aren't in the post yet (lib/studio/reelPost.ts reelOffers):
 * a new render of one of its reels ("Use it" swaps it in at that place) or a
 * reel made for this post ("Add", or "Not for this post" to stop offering
 * it). Nothing changes until one is tapped; the media editor saves it like
 * any other change (back to Waiting is asked first).
 */
export function ReelOffers({
  offers,
  count,
  story,
  off,
  onReplace,
  onAdd,
}: {
  offers: ReelOffer[];
  count: number;
  story: boolean;
  off: boolean;
  onReplace: (index: number, pick: ReelPick) => void;
  onAdd: (pick: ReelPick) => void;
}) {
  const unlink = useMutation(api.reels.update);
  const [dropping, setDropping] = useState<string | null>(null);

  async function drop(o: Extract<ReelOffer, { type: "add" }>) {
    setDropping(o.draft.id);
    try {
      await unlink({ id: o.draft.id, postId: null, baseUpdatedAt: o.draft.updatedAt });
      showAlert("It stays in Reels.", "success");
    } catch (err) {
      showError(err);
    } finally {
      setDropping(null);
    }
  }

  return (
    <ul className="st-inset st-qm-list st-qm-offers" aria-label="Reels rendered for this post">
      {offers.map((o) => {
        const pick = reelPick(o.draft);
        if (!pick) return null;
        const problem = story ? storyItemProblem(pick) : null;
        const full = o.type === "add" ? addProblem(count, story) : null;
        const why = problem ?? full;
        return (
          <li key={`${o.type}-${o.draft.id}`} className="st-qm-item">
            <span className="st-qm-thumb is-still" aria-hidden="true">
              <video src={`${pick.url}#t=0.1`} muted playsInline preload="metadata" tabIndex={-1} />
            </span>
            <div className="st-qm-tx">
              <b>{o.type === "replace" ? `New render of item ${o.index + 1}` : o.draft.title}</b>
              <small>{o.type === "replace" ? `${o.draft.title} · ${draftLine(o.draft)}` : `Rendered for this post · ${draftLine(o.draft)}`}</small>
              {why && <small>{why}</small>}
            </div>
            <div className="st-qm-acts">
              {o.type === "replace" ? (
                <button type="button" className="st-btn st-btn-sm" onClick={() => onReplace(o.index, pick)} disabled={off || !!why}>
                  Use it
                </button>
              ) : (
                <>
                  <button type="button" className="st-btn st-btn-sm" onClick={() => onAdd(pick)} disabled={off || !!why}>
                    Add
                  </button>
                  <button type="button" className="st-btn st-btn-ghost st-btn-sm" onClick={() => drop(o)} disabled={off || dropping !== null} data-busy={dropping === o.draft.id || undefined}>
                    Not for this post
                  </button>
                </>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
