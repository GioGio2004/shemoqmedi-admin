"use client";

import { memo, useEffect, useRef, useState } from "react";
import { frameAtSource } from "@/lib/reel/probe";
import { isVideoKind, type ClipSource } from "@/lib/reel/recipe";
import { ikUrl } from "../../media";
import { ReelIcon } from "../../icons";

// A clip's small picture for the timeline and the pickers: a still's
// ImageKit thumbnail, or a video's frame at `sec` (decoded once per URL and
// time, kept in a small cache; evicted bitmaps are closed).

const CACHE_MAX = 80;
const cache = new Map<string, Promise<ImageBitmap>>();

function frameThumb(url: string, sec: number, width: number) {
  const key = `${url}#${sec.toFixed(1)}@${width}`;
  const hit = cache.get(key);
  if (hit) {
    // Most recently used goes last.
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }
  const p = frameAtSource(url, sec, width);
  // A failed decode is not kept: the next mount tries again.
  p.catch(() => cache.delete(key));
  cache.set(key, p);
  while (cache.size > CACHE_MAX) {
    const [oldKey, old] = cache.entries().next().value as [string, Promise<ImageBitmap>];
    cache.delete(oldKey);
    old.then((b) => b.close(), () => {});
  }
  return p;
}

function VideoThumb({ url, sec, width, alt }: { url: string; sec: number; width: number; alt: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
  useEffect(() => {
    let live = true;
    frameThumb(url, Math.max(0, sec), width).then(
      (bitmap) => {
        const c = ref.current;
        if (!live || !c) return;
        try {
          c.width = bitmap.width;
          c.height = bitmap.height;
          c.getContext("2d")?.drawImage(bitmap, 0, 0);
          setState("ready");
        } catch {
          // Closed by the cache meanwhile: keep the placeholder.
          setState("failed");
        }
      },
      () => live && setState("failed"),
    );
    return () => {
      live = false;
    };
  }, [url, sec, width]);
  return (
    <>
      <canvas ref={ref} className="st-re-thumb-img" data-ready={state === "ready"} role="img" aria-label={alt} />
      {state !== "ready" && (
        <span className="st-re-thumb-ph" aria-hidden="true">
          {state === "failed" ? <ReelIcon size={18} /> : null}
        </span>
      )}
    </>
  );
}

export const ClipThumb = memo(function ClipThumb({ source, sec = 0, width = 200, alt = "" }: { source: ClipSource; sec?: number; width?: number; alt?: string }) {
  const [loaded, setLoaded] = useState(false);
  if (isVideoKind(source.kind)) return <VideoThumb url={source.url} sec={sec + 0.05} width={width} alt={alt} />;
  return (
    <>
      <img
        className="st-re-thumb-img"
        data-ready={loaded}
        src={ikUrl(source.url, width)}
        alt={alt}
        draggable={false}
        ref={(el) => {
          if (el?.complete && el.naturalWidth && !loaded) setLoaded(true);
        }}
        onLoad={() => setLoaded(true)}
      />
      {!loaded && <span className="st-re-thumb-ph" aria-hidden="true" />}
    </>
  );
});
