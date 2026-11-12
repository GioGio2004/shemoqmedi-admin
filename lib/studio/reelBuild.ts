// The reel being built (components/studio/reels/Reels.tsx), held outside the
// page: building and uploading take minutes, and the Studio's tab bar stays
// live meanwhile. Leaving Reels no longer abandons the work; it finishes in
// the background, and the finished reel (kept on this device) is there to
// post when Reels opens again. While a build runs, a reload or closing the
// app asks first (beforeunload), since that would stop the encode.

import { createDraftStore, type DraftStore } from "./persist";

export type BuildStage = { label: string; fraction?: number };

/** A finished, uploaded reel and what it was built from. */
export type BuiltReel = {
  url: string;
  width: number;
  height: number;
  durationSec: number;
  heldSec: number;
  size: number;
  listingId: string;
  audioUrl: string;
};

export type ReelBuildState = { stage: BuildStage | null; done: BuiltReel | null };

type UnloadTarget = Pick<Window, "addEventListener" | "removeEventListener">;

function onBeforeUnload(event: BeforeUnloadEvent) {
  // The standard way to ask before leaving (HTML: preventDefault; returnValue for older browsers).
  event.preventDefault();
  event.returnValue = "";
}

export function createReelBuilds(
  drafts: DraftStore<BuiltReel> = createDraftStore<BuiltReel>("reel"),
  unloadTarget: () => UnloadTarget | null = () => (typeof window === "undefined" ? null : window),
) {
  let state: ReelBuildState | null = null;
  const listeners = new Set<() => void>();
  const current = () => (state ??= { stage: null, done: drafts.get("last") });
  const set = (next: ReelBuildState) => {
    state = next;
    listeners.forEach((l) => l());
  };

  return {
    get: current,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    /**
     * Runs one build: `steps` reports its stages and returns the uploaded
     * reel. Null when a build is already running. Keeps going after the page
     * that started it unmounts.
     */
    async run(
      from: { listingId: string; audioUrl: string },
      steps: (report: (stage: BuildStage) => void) => Promise<Omit<BuiltReel, "listingId" | "audioUrl">>,
    ): Promise<BuiltReel | null> {
      if (current().stage) return null;
      const target = unloadTarget();
      target?.addEventListener("beforeunload", onBeforeUnload);
      set({ stage: { label: "Building the reel", fraction: 0 }, done: null });
      drafts.set("last", null);
      try {
        const out = await steps((stage) => set({ ...current(), stage }));
        const done: BuiltReel = { ...out, ...from };
        drafts.set("last", done);
        set({ stage: null, done });
        return done;
      } catch (err) {
        set({ stage: null, done: null });
        throw err;
      } finally {
        target?.removeEventListener("beforeunload", onBeforeUnload);
      }
    },
    /** Forget the finished reel (it was posted, or a new one replaces it). */
    clear() {
      drafts.set("last", null);
      set({ ...current(), done: null });
    },
  };
}

/** The Studio's one reel build. */
export const reelBuilds = createReelBuilds();
