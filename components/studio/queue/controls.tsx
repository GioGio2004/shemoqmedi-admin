"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { showAlert, showError } from "@/components/admin/Alerts";
import { captionsForSave, type Captions } from "@/lib/studio/captions";
import { postActions } from "@/lib/studio/queue";
import { formatTbilisi } from "@/lib/studio/time";
import { RejectSheet, TimeSheet } from "../TimeSheet";
import { ConfirmSheet } from "../ui";
import { dropFromQueues } from "./optimistic";
import { listNames, targetNetworks, type Post } from "./view";

export type Busy = "publish" | "schedule" | "unschedule" | "retry" | "reject" | "save" | null;

/**
 * Everything a post can have done to it, for its card and its detail sheet:
 * the same mutations (with the same optimistic moves between tabs), the
 * same confirmations (Publish now asks first; Schedule picks a time; Reject
 * takes a note) and the same messages as before the redesign. `error` keeps
 * the last failure for a sheet to show inline (a toast only lasts a few
 * seconds).
 */
export function usePostControls(post: Post, now: number, { onRejected }: { onRejected?: () => void } = {}) {
  const update = useMutation(api.social.update);
  const publish = useMutation(api.social.publish).withOptimisticUpdate((store, { id }) => dropFromQueues(store, id, ["all", "scheduled"]));
  const unschedule = useMutation(api.social.unschedule).withOptimisticUpdate((store, { id }) => dropFromQueues(store, id, ["all", "waiting"]));
  const reject = useMutation(api.social.reject).withOptimisticUpdate((store, { id }) => dropFromQueues(store, id, ["all", "rejected"]));
  const retry = useMutation(api.social.retry).withOptimisticUpdate((store, { id }) => dropFromQueues(store, id, ["all", "scheduled", "sent"]));

  const [sheet, setSheet] = useState<"publish" | "schedule" | "reject" | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<unknown>(null);

  const actions = postActions(post, now);
  const story = post.placement === "story";
  const goesTo = listNames(targetNetworks(post, post.captions)) || "no network yet";

  async function run(label: Exclude<Busy, null>, fn: () => Promise<unknown>, done?: string) {
    setBusy(label);
    setError(null);
    try {
      await fn();
      if (done) showAlert(done, "success");
    } catch (err) {
      showError(err);
      setError(err);
      throw err;
    } finally {
      setBusy(null);
    }
  }

  const sheets = (
    <>
      <ConfirmSheet
        open={sheet === "publish"}
        onClose={() => setSheet(null)}
        title="Publish now?"
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
        intro={
          <>
            Goes out {story ? "as a story " : ""}to <strong>{goesTo}</strong> at this time.
          </>
        }
        onPick={(at) => run("schedule", () => publish({ id: post.id, at }), `Scheduled for ${formatTbilisi(at)}.`)}
      />
      <RejectSheet
        open={sheet === "reject"}
        onClose={() => setSheet(null)}
        onReject={async (note) => {
          await run("reject", () => reject({ id: post.id, note: note || undefined }), "Rejected.");
          onRejected?.();
        }}
      />
    </>
  );

  return {
    actions,
    busy,
    error,
    clearError: () => setError(null),
    sheets,
    askPublish: () => setSheet("publish"),
    askSchedule: () => setSheet("schedule"),
    askReject: () => setSheet("reject"),
    unschedule: () => run("unschedule", () => unschedule({ id: post.id }), "Unscheduled: back in Waiting.").catch(() => {}),
    retry: () => run("retry", () => retry({ id: post.id }), "Publishing the networks that didn't go out.").catch(() => {}),
    /** Saves the caption edits; `clear` drops the kept draft once saved. */
    save: (draft: Captions | null, clear: () => void) =>
      run(
        "save",
        async () => {
          await update({ id: post.id, captions: captionsForSave(draft ?? {}) });
          clear();
        },
        actions.editResets ? "Saved. The post is back in Waiting." : "Saved.",
      ).catch(() => {}),
  };
}

export type PostControls = ReturnType<typeof usePostControls>;
