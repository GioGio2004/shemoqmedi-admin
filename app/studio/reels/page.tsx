import type { Metadata } from "next";
import { Suspense } from "react";
import { ReelsRoute } from "@/components/studio/reels/Reels";

export const metadata: Metadata = { title: "Reels" };

// /reels is the Reels tab (reel drafts, recent reels, the quick voiceover
// reel). ?draft=<id> opens the reel editor with that draft (push links land
// here); &post=<id>&item=<i> means it was opened from that post and its
// render can replace that item; ?new=1[&post=<id>] starts a new reel (for
// that post). docs/reel-editor.md section 6.
//
// The choice is made on the client from the address bar: once a new reel is
// saved, the editor rewrites ?new=1 to ?draft=<id> (history.replaceState,
// which Next syncs into useSearchParams without a server round trip), and a
// reload or Back then opens that draft.
export default function ReelsPage() {
  return (
    <Suspense fallback={null}>
      <ReelsRoute />
    </Suspense>
  );
}
