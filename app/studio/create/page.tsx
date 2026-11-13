import type { Metadata } from "next";
import { Create } from "@/components/studio/create/Create";
import { EditCreate } from "@/components/studio/create/EditCreate";
import { parseEditTarget } from "@/lib/studio/postEdit";

export const metadata: Metadata = { title: "Create" };

type Params = { output?: string | string[]; post?: string | string[]; item?: string | string[]; mode?: string | string[] };

// ?output=story starts a story (the Home quick action). ?post=<id>&item=<i>
// edits that post's media item from its design recipe; ?post=<id>&mode=add
// makes a new graphic for the post (docs/post-editing.md).
export default async function CreatePage({ searchParams }: { searchParams: Promise<Params> }) {
  const { output, post, item, mode } = await searchParams;
  const target = parseEditTarget({ post, item, mode });
  if (target) return <EditCreate key={`${target.postId}-${target.item ?? "add"}`} target={target} />;
  const first = Array.isArray(output) ? output[0] : output;
  const initial = first === "story" || first === "carousel" ? first : "single";
  return <Create key={initial} initialOutput={initial} />;
}
