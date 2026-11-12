"use client";

import { useEffect, useSyncExternalStore } from "react";
import type { PreviewAssets } from "@/lib/graphics/preview";

// Preview assets (GET /api/graphics/assets) by URL, fetched once per
// screenshot + palette + glass + format and shared by every preview on the
// page (the big one, the palette strip, the style cards). Typing never
// refetches: text isn't part of the URL. A copy that only reads the cache
// (fetch: false) shows what is already here and asks for nothing.

const MAX = 48;
const cache = new Map<string, PreviewAssets | null>();
const loading = new Set<string>();
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function load(url: string) {
  if (cache.has(url) || loading.has(url)) return;
  loading.add(url);
  fetch(url, { credentials: "same-origin" })
    .then((r) => (r.ok ? (r.json() as Promise<PreviewAssets>) : null))
    .catch(() => null)
    .then((assets) => {
      loading.delete(url);
      // A failed fetch keeps the stand-in (the blurred screenshot); it is tried again on the next mount.
      if (!assets) return;
      cache.set(url, assets);
      if (cache.size > MAX) cache.delete(cache.keys().next().value!);
      emit();
    });
}

/** The assets for `url` (null while loading, or when the preview needs none). `fetch: false` reads only what is cached. */
export function useAssets(url: string | null, { fetch: allowFetch = true }: { fetch?: boolean } = {}): PreviewAssets | null {
  const value = useSyncExternalStore(
    subscribe,
    () => (url ? (cache.get(url) ?? null) : null),
    () => null,
  );
  useEffect(() => {
    if (url && allowFetch) load(url);
  }, [url, allowFetch]);
  return value;
}
