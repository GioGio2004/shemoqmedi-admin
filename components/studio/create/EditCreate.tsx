"use client";

import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { editBlockReason, seedForEdit, targetProblem, type EditTarget } from "@/lib/studio/postEdit";
import { postActions } from "@/lib/studio/queue";
import { ErrorBoundary } from "../ui";
import { Create } from "./Create";
import { EditBlocked, EditLoading, type PostDetail } from "./EditParts";

// Create in edit mode: loads the post (social.get, with each item's design
// recipe), finds its listing's id (by slug, for the listing picker and the
// carousel), then starts Create from the recipe, or from the post itself
// when the image has none. A post that can't be edited shows why.

export function EditCreate({ target }: { target: EditTarget }) {
  return (
    <ErrorBoundary fallback={<EditBlocked message="This post can't be opened. It may have been deleted." postId={null} />}>
      <EditLoader target={target} />
    </ErrorBoundary>
  );
}

function EditLoader({ target }: { target: EditTarget }) {
  const post = useQuery(api.social.get, { id: target.postId as Id<"socialPosts"> });
  // The listing's id by its slug (social.get names the listing, not its id); a carousel recipe has its own.
  const options = useQuery(api.admin.featuredOptions, post?.listing ? {} : "skip");
  if (post === undefined || (post.listing && options === undefined)) return <EditLoading />;
  const listingId = (post.listing && options?.find((l) => l.slug === post.listing!.slug)?.id) || null;
  return <EditStart target={target} post={post} listingId={listingId} />;
}

/** Checks once, when the post first loads, that it can be edited; Create then keeps watching it. */
function EditStart({ target, post, listingId }: { target: EditTarget; post: PostDetail; listingId: string | null }) {
  const [problem] = useState(() => editBlockReason(post, postActions(post, Date.now())) ?? targetProblem(post, target));
  // The seed and Create's base media come from the same copy of the post; Start over takes a new copy of both.
  const [start, setStart] = useState(() => ({ n: 0, seed: seedForEdit(post, target, listingId) }));
  const restart = () => setStart((s) => ({ n: s.n + 1, seed: seedForEdit(post, target, listingId) }));
  if (problem) return <EditBlocked message={problem} postId={post.id} />;
  return <Create key={start.n} initialOutput={start.seed.output} edit={{ target, post, seed: start.seed, restart }} />;
}
