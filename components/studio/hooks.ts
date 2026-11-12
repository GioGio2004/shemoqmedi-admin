"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import type { DraftStore } from "@/lib/studio/persist";

/** The time, ticking every `everyMs` (a query is not re-run as time passes). */
export function useNow(everyMs = 15_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), everyMs);
    return () => window.clearInterval(t);
  }, [everyMs]);
  return now;
}

/** A media query's match; false on the server. */
export function useMedia(query: string) {
  const subscribe = useCallback(
    (cb: () => void) => {
      const m = window.matchMedia(query);
      m.addEventListener("change", cb);
      return () => m.removeEventListener("change", cb);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/** An element's content width, kept current with a ResizeObserver (0 until measured). */
export function useWidth<T extends HTMLElement>() {
  const [el, setEl] = useState<T | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return [setEl, width] as const;
}

/** Whether this browser can build a reel (WebCodecs video + audio encoders); null on the server. */
export function useCanEncode() {
  return useSyncExternalStore(
    () => () => {},
    () => typeof window !== "undefined" && "VideoEncoder" in window && "AudioEncoder" in window,
    () => null,
  );
}

/** One draft from a draft store (lib/studio/persist.ts), kept current; null on the server. */
export function useDraft<T>(store: DraftStore<T>, id: string): T | null {
  return useSyncExternalStore(
    store.subscribe,
    () => store.get(id),
    () => null,
  );
}
