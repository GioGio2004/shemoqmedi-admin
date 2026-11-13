"use client";

import Link from "next/link";
import type { FunctionReturnType } from "convex/server";
import type { api } from "@/convex/_generated/api";
import type { EditSeed, EditTarget } from "@/lib/studio/postEdit";
import { queueUrlFor } from "@/lib/studio/postEdit";
import { PageHead, Skel } from "../ui";

// Pieces of Create's edit mode (/create?post=<id>&item=<i> or &mode=add):
// the "Editing …" banner, and the screens shown while the post loads or
// when it can't be edited. The flow itself is Create (components/studio/create/Create.tsx).

export type PostDetail = FunctionReturnType<typeof api.social.get>;

/** What Create gets in edit mode: the post (live), the target item, and the choices it starts from. */
export type EditMode = {
  target: EditTarget;
  post: PostDetail;
  seed: EditSeed;
  /** Start over from the post as it is now: a new seed, and Create mounted again (its draft cleared first). */
  restart: () => void;
};

/** "Editing Floema · image 2", with Cancel (back to the queue, nothing saved). */
export function EditBanner({ title, label, note, onCancel, busy }: { title: string; label: string; note: string | null; onCancel: () => void; busy: boolean }) {
  return (
    <div className="st-create-editing st-glass" role="status">
      <span className="st-create-editing-text">
        <span className="st-create-editing-line">
          Editing <strong>{title}</strong>
          <span className="st-create-editing-what"> · {label}</span>
        </span>
        {note && <small>{note}</small>}
      </span>
      <button type="button" className="st-btn st-btn-quiet st-btn-sm" onClick={onCancel} disabled={busy}>
        Cancel
      </button>
    </div>
  );
}

/** While the post loads. */
export function EditLoading() {
  return (
    <>
      <PageHead section="Create" title="Edit." />
      <div className="st-create st-create-steps" aria-busy="true">
        {[0, 1, 2].map((i) => (
          <Skel key={i} style={{ height: 140, borderRadius: 30 }} />
        ))}
      </div>
    </>
  );
}

/** A post that can't be edited here (sent, publishing, gone, a broken link): why, and the way back. */
export function EditBlocked({ message, postId }: { message: string; postId: string | null }) {
  return (
    <>
      <PageHead section="Create" title="Edit." />
      <div className="st-create-steps">
        <p className="st-callout">{message}</p>
        <Link className="st-btn st-btn-ghost st-create-start" href={postId ? queueUrlFor(postId) : "/queue"}>
          Back to the queue
        </Link>
      </div>
    </>
  );
}
