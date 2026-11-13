"use client";

import { useImperativeHandle, useLayoutEffect, useRef, useState, type ReactNode, type Ref } from "react";
import { ChevronLeftIcon, ChevronRightIcon } from "../icons";
import { ikSrcSet, ikUrl } from "../media";
import { PlayGlyph } from "./glyphs";
import type { Post } from "./view";

// A post's pictures, flush and swipeable (scroll snap), at their true aspect
// ratio: 9:16 for a story, otherwise the first picture's own shape (4:5 until
// it has loaded; remembered per URL so a card that remounts doesn't jump).
// Pictures load as they come near: no native lazy loading (it can stall
// inside scrollers and animated cards), the first slide when the card is
// near the screen (or at once with `eager`), each next slide one swipe ahead.

const ratios = new Map<string, number>();
const fitRatio = (w: number, h: number) => Math.min(1.91, Math.max(9 / 16, w / h));

export type CarouselControl = {
  /** Scroll to slide i. */
  go: (i: number, smooth?: boolean) => void;
  /** Slide i's picture (img or video), for the shared-element motion. */
  media: (i: number) => HTMLElement | null;
  index: () => number;
};

const markLoaded = (el: HTMLImageElement | null) => {
  if (el && el.complete && el.naturalWidth) el.classList.add("is-loaded");
};

export function Carousel({
  media,
  label,
  story,
  eager = false,
  near = true,
  start = 0,
  width = 720,
  sizes,
  className = "",
  control,
  top,
  bottom,
  onOpen,
  onIndex,
  onVideoMeta,
}: {
  media: Post["media"];
  label: string;
  story: boolean;
  /** Load the first picture right away (the first screen). */
  eager?: boolean;
  /** The carousel is near the screen: load its pictures. */
  near?: boolean;
  start?: number;
  /** ImageKit width for src (srcset covers the rest). */
  width?: number;
  sizes: string;
  className?: string;
  control?: Ref<CarouselControl>;
  /** Chips over the top left (the counter is added on the right). */
  top?: ReactNode;
  /** Over the bottom left (the info pill). */
  bottom?: ReactNode;
  onOpen?: (index: number, el: HTMLElement) => void;
  onIndex?: (index: number) => void;
  /** A video slide's length, once its metadata has loaded (the card's reel chip). */
  onVideoMeta?: (index: number, durationSec: number) => void;
}) {
  const n = media.length;
  const track = useRef<HTMLDivElement>(null);
  const first = media[0]?.url ?? "";
  const [idx, setIdx] = useState(() => Math.min(Math.max(0, start), Math.max(0, n - 1)));
  const [seen, setSeen] = useState(idx);
  const [measured, setMeasured] = useState<number | null>(null);
  const ratio = story ? 9 / 16 : (measured ?? ratios.get(first) ?? 4 / 5);
  const raf = useRef(0);

  // Open at `start` without a scroll animation.
  useLayoutEffect(() => {
    const t = track.current;
    if (t && idx > 0) t.scrollLeft = idx * t.clientWidth;
    // Only on mount: later moves come from the user or `go`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useImperativeHandle(
    control,
    () => ({
      go: (i, smooth = true) => {
        const t = track.current;
        if (!t) return;
        t.scrollTo({ left: i * t.clientWidth, behavior: smooth ? "smooth" : "auto" });
      },
      media: (i) => track.current?.children[i]?.querySelector<HTMLElement>("img, video") ?? null,
      index: () => idx,
    }),
    [idx],
  );

  const onScroll = () => {
    if (raf.current) return;
    raf.current = requestAnimationFrame(() => {
      raf.current = 0;
      const t = track.current;
      if (!t) return;
      const i = Math.min(n - 1, Math.max(0, Math.round(t.scrollLeft / Math.max(1, t.clientWidth))));
      if (i === idx) return;
      setIdx(i);
      setSeen((s) => Math.max(s, i));
      onIndex?.(i);
    });
  };

  const sized = (w: number, h: number) => {
    if (story || !w || !h) return;
    const r = fitRatio(w, h);
    ratios.set(first, r);
    setMeasured(r);
  };

  const step = (d: number) => {
    const t = track.current;
    if (t) t.scrollTo({ left: Math.min(n - 1, Math.max(0, idx + d)) * t.clientWidth, behavior: "smooth" });
  };

  return (
    <div className={`st-queue-car ${className}`} data-story={story || undefined}>
      <div ref={track} className="st-car-track" onScroll={n > 1 ? onScroll : undefined}>
        {media.map((m, i) => {
          const load = i === 0 ? eager || near : near && i <= seen + 1;
          const video = m.kind === "video";
          return (
            <button
              key={`${m.url}-${i}`}
              type="button"
              className="st-car-slide"
              style={{ aspectRatio: ratio }}
              aria-label={`View ${video ? "video" : "picture"} ${i + 1} of ${n}: ${label}`}
              onClick={(e) => onOpen?.(i, e.currentTarget)}
            >
              {load &&
                (video ? (
                  <video
                    className="st-fade-img is-loaded"
                    src={m.url}
                    muted
                    playsInline
                    preload="metadata"
                    aria-hidden="true"
                    tabIndex={-1}
                    onLoadedMetadata={(e) => {
                      const v = e.currentTarget;
                      if (i === 0) sized(v.videoWidth, v.videoHeight);
                      if (Number.isFinite(v.duration) && v.duration > 0) onVideoMeta?.(i, v.duration);
                    }}
                  />
                ) : (
                  <img
                    ref={markLoaded}
                    className="st-fade-img"
                    src={ikUrl(m.url, width)}
                    srcSet={ikSrcSet(m.url)}
                    sizes={sizes}
                    alt=""
                    decoding="async"
                    draggable={false}
                    onLoad={(e) => {
                      e.currentTarget.classList.add("is-loaded");
                      if (i === 0) sized(e.currentTarget.naturalWidth, e.currentTarget.naturalHeight);
                    }}
                    onError={(e) => e.currentTarget.classList.add("is-loaded")}
                  />
                ))}
              {video && (
                <span className="st-queue-play" aria-hidden="true">
                  <PlayGlyph size={18} />
                </span>
              )}
            </button>
          );
        })}
      </div>
      {(top || n > 1) && (
        <div className="st-media-top">
          {top}
          {n > 1 && (
            <span className="st-mchip" aria-hidden="true">
              {idx + 1}/{n}
            </span>
          )}
        </div>
      )}
      {n > 1 && (
        <>
          <button type="button" className="st-queue-car-nav is-prev lq round" aria-label="Previous picture" onClick={() => step(-1)} disabled={idx === 0}>
            <ChevronLeftIcon size={18} />
          </button>
          <button type="button" className="st-queue-car-nav is-next lq round" aria-label="Next picture" onClick={() => step(1)} disabled={idx === n - 1}>
            <ChevronRightIcon size={18} />
          </button>
          <div className="st-dots" aria-hidden="true">
            {media.map((m, i) => (
              <i key={`${m.url}-${i}`} className={i === idx ? "on" : undefined} />
            ))}
          </div>
        </>
      )}
      {bottom}
    </div>
  );
}
