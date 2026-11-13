"use client";

import { useState } from "react";
import { ikSrcSet, ikUrl, isVideoUrl } from "../media";

// Home's pictures: sized through ImageKit, faded in once loaded, always eager
// (they sit inside the bento's rise animation, where lazy images may never load).

type Item = { kind: "image" | "video"; url: string };

/** A post's first picture (not a video), or null. */
export function firstImage<T extends Item>(post: { media: readonly T[] }): T | null {
  return post.media.find((m) => m.kind === "image" && !isVideoUrl(m.url)) ?? null;
}

/** An image that fades in when it has loaded (also when it was already in the cache). */
export function FadeImg({ url, width, widths, sizes, alt = "" }: { url: string; width: number; widths: number[]; sizes: string; alt?: string }) {
  const [loaded, setLoaded] = useState(false);
  return (
    <img
      ref={(el) => {
        if (el?.complete && el.naturalWidth > 0) setLoaded(true);
      }}
      className={`st-fade-img${loaded ? " is-loaded" : ""}`}
      src={ikUrl(url, width)}
      srcSet={ikSrcSet(url, widths)}
      sizes={sizes}
      alt={alt}
      decoding="async"
      draggable={false}
      onLoad={() => setLoaded(true)}
      onError={() => setLoaded(true)}
    />
  );
}

/** A published post's tile picture: its first image, or the first frame of its video. */
export function Thumb({ item }: { item: Item }) {
  if (item.kind === "video" || isVideoUrl(item.url)) {
    return <video src={`${item.url}#t=0.1`} muted playsInline preload="metadata" aria-hidden="true" tabIndex={-1} />;
  }
  return <FadeImg url={item.url} width={480} widths={[240, 480, 720]} sizes="(min-width: 900px) 210px, 64vw" />;
}

/** A portrait frame: a story (the Studio's icon set has none). */
export function StoryIcon({ size = 22 }: { size?: number }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <rect x="6.5" y="3.5" width="11" height="17" rx="3" />
      <path d="M12 9.5v5M9.5 12h5" />
    </svg>
  );
}
