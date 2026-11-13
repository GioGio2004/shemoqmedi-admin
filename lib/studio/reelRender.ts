// The reel editor's render (components/studio/reels/editor/RenderSheet.tsx),
// held outside the page like lib/studio/reelBuild.ts: rendering and
// uploading take minutes and the Studio's tab bar stays live, so leaving the
// editor doesn't stop it. One render at a time; Cancel aborts it. The last
// finished render of each draft is kept on this device, so it is there to
// use in a post when the editor opens again. While a render runs, a reload
// or closing the app asks first (beforeunload), since that would stop it.

import { createDraftStore, type DraftStore } from "./persist";

export type RenderStage = { label: string; fraction?: number };

/** A finished, uploaded, registered reel and what it was made from. */
export type RenderedReel = {
  url: string;
  mediaId: string;
  width: number;
  height: number;
  durationSec: number;
  size: number;
  /** The draft it belongs to ("new" when it had none). */
  key: string;
  /** lib/studio/reelEditor.ts recipeKey of the recipe it was made from. */
  recipeKey: string;
  at: number;
};

export type RenderJobState = {
  /** The draft whose render is running, or null. */
  running: string | null;
  stage: RenderStage | null;
};

type UnloadTarget = Pick<Window, "addEventListener" | "removeEventListener">;

function onBeforeUnload(event: BeforeUnloadEvent) {
  event.preventDefault();
  event.returnValue = "";
}

/** True for an error that means "stopped on purpose" (Cancel). */
export function isCancelled(err: unknown) {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: unknown; name?: unknown };
  return e.code === "cancelled" || e.name === "AbortError";
}

export function createReelRenders(
  drafts: DraftStore<RenderedReel> = createDraftStore<RenderedReel>("reel-render"),
  unloadTarget: () => UnloadTarget | null = () => (typeof window === "undefined" ? null : window),
) {
  let state: RenderJobState = { running: null, stage: null };
  let controller: AbortController | null = null;
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((l) => l());
  const set = (next: RenderJobState) => {
    state = next;
    emit();
  };

  return {
    get: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    /** The last finished render of a draft on this device. */
    done(key: string): RenderedReel | null {
      return drafts.get(key);
    },
    /**
     * Runs one render for draft `key`: `steps` reports its stages and returns
     * the uploaded reel. Null when a render is already running. Keeps going
     * after the page that started it unmounts. Throws what `steps` throws
     * (a cancel too: check isCancelled).
     */
    async run(
      key: string,
      recipeKey: string,
      steps: (report: (stage: RenderStage) => void, signal: AbortSignal) => Promise<Omit<RenderedReel, "key" | "recipeKey" | "at">>,
    ): Promise<RenderedReel | null> {
      if (state.running) return null;
      const ac = new AbortController();
      controller = ac;
      const target = unloadTarget();
      target?.addEventListener("beforeunload", onBeforeUnload);
      set({ running: key, stage: { label: "Preparing", fraction: 0 } });
      try {
        const out = await steps((stage) => {
          if (!ac.signal.aborted) set({ running: key, stage });
        }, ac.signal);
        // Steps that finished are done (a cancel that came after the upload still leaves a saved reel): keep it.
        const done: RenderedReel = { ...out, key, recipeKey, at: Date.now() };
        drafts.set(key, done);
        return done;
      } finally {
        controller = null;
        target?.removeEventListener("beforeunload", onBeforeUnload);
        set({ running: null, stage: null });
      }
    },
    /** Stops the running render (its steps see the signal abort). */
    cancel() {
      controller?.abort();
    },
    /** Forget a draft's finished render on this device. */
    clear(key: string) {
      drafts.set(key, null);
      set({ ...state });
    },
    /** A render made before the draft existed now belongs to it. */
    adopt(from: string, to: string) {
      const done = drafts.get(from);
      if (!done || from === to) return;
      drafts.set(to, { ...done, key: to });
      drafts.set(from, null);
      set({ ...state });
    },
  };
}

export type ReelRenders = ReturnType<typeof createReelRenders>;

/** The Studio's one reel render. */
export const reelRenders = createReelRenders();
