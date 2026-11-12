import type { Metadata } from "next";
import { Queue } from "@/components/studio/queue/Queue";
import { parseQueueTab } from "@/lib/studio/queue";

export const metadata: Metadata = { title: "Queue" };

// ?status= picks the tab (old /social?status= links land here too); ?post=<id> opens one post on top (publish pushes link it).
export default async function QueuePage({ searchParams }: { searchParams: Promise<{ status?: string | string[]; post?: string | string[] }> }) {
  const { status, post } = await searchParams;
  const postId = Array.isArray(post) ? post[0] : post;
  const tab = parseQueueTab(status);
  const id = postId?.trim() || null;
  // Keyed, so a new link to the queue starts from its own tab and post.
  return <Queue key={`${tab}-${id}`} initialTab={tab} postId={id} />;
}
