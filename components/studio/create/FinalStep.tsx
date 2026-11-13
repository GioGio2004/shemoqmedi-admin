"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Lightbox } from "../Lightbox";
import { ikSrcSet, ikUrl } from "../media";

export type Rendered = { key: string; urls: string[]; width: number; height: number };

function Elapsed({ since }: { since: number }) {
  const [now, setNow] = useState(since);
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(t);
  }, []);
  return <span className="st-tnum">{((now - since) / 1000).toFixed(1)} s</span>;
}

/** A picture that fades in once loaded (and is never left invisible: a cached or failed load shows too). */
function FadeImg({ src, srcSet, sizes, width, height }: { src: string; srcSet?: string; sizes?: string; width: number; height: number }) {
  const ref = useRef<HTMLImageElement>(null);
  const [loaded, setLoaded] = useState(false);
  useLayoutEffect(() => {
    if (ref.current?.complete) setLoaded(true);
  }, [src]);
  return (
    <img
      ref={ref}
      className={`st-fade-img${loaded ? " is-loaded" : ""}`}
      src={src}
      srcSet={srcSet}
      sizes={sizes}
      width={width}
      height={height}
      alt=""
      decoding="async"
      onLoad={() => setLoaded(true)}
      onError={() => setLoaded(true)}
    />
  );
}

/**
 * The server's exact JPEG(s): the preview is the browser's drawing, this is
 * what gets posted. Any change to the design afterwards marks it stale. The
 * pictures sit flush on their own corners; a tap opens them full screen.
 */
export function FinalStep({
  rendered,
  stale,
  rendering,
  onRender,
  slots,
  ratio,
  glass,
}: {
  rendered: Rendered | null;
  stale: boolean;
  rendering: number | null;
  onRender: () => void;
  /** How many images to expect (1, or about 7 for a carousel), for the placeholders. */
  slots: number;
  ratio: number;
  glass: boolean;
}) {
  const height = 240;
  const shown = rendered && rendering === null ? rendered : null;
  const boxes = shown ? shown.urls.length : slots;
  const slides = useRef<(HTMLButtonElement | null)[]>([]);
  const [viewer, setViewer] = useState<{ index: number; el: Element } | null>(null);

  const scrollTo = (i: number) => slides.current[i]?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });

  return (
    <div className="st-stack">
      <div className="st-create-finals" data-stale={stale || undefined} aria-live="polite" aria-busy={rendering !== null}>
        {Array.from({ length: boxes }, (_, i) => {
          const url = shown?.urls[i];
          const w = Math.round(height * (shown ? shown.width / shown.height : ratio));
          return url ? (
            <button
              key={url}
              ref={(el) => {
                slides.current[i] = el;
              }}
              type="button"
              className="st-create-final"
              style={{ width: w, height }}
              aria-label={`View final image ${i + 1} of ${boxes}`}
              onClick={(e) => setViewer({ index: i, el: e.currentTarget })}
            >
              <FadeImg src={ikUrl(url, w * 2)} srcSet={ikSrcSet(url, [w, w * 2, w * 3])} sizes={`${w}px`} width={shown!.width} height={shown!.height} />
              {boxes > 1 && <span className="st-mchip st-create-final-index">{i + 1}</span>}
            </button>
          ) : (
            <span key={i} className={rendering !== null ? "st-skel st-create-slot" : "st-create-slot"} style={{ width: w, height }} aria-hidden="true">
              {rendering === null && boxes > 1 && <span>{i + 1}</span>}
            </span>
          );
        })}
      </div>
      {rendering !== null && (
        <div className="st-stack" style={{ gap: 6 }}>
          <div className="st-progress" data-indeterminate="true">
            <span />
          </div>
          <p className="st-note" aria-live="polite">
            Rendering on the server… <Elapsed since={rendering} />
            {glass ? " · glass takes a few seconds" : ""}
          </p>
        </div>
      )}
      {stale && rendered && rendering === null && <p className="st-callout">The design changed since this render. Render again to post what you see.</p>}
      <div className="st-create-render">
        <button type="button" className={`st-btn${rendered && !stale ? " st-btn-ghost" : ""}`} onClick={onRender} disabled={rendering !== null} data-busy={rendering !== null}>
          {rendered ? "Render again" : "Render final"}
        </button>
        {rendered && !stale && rendering === null && (
          <span className="st-note st-tnum">
            {rendered.urls.length} image{rendered.urls.length === 1 ? "" : "s"} · {rendered.width}×{rendered.height} · JPEG
          </span>
        )}
      </div>
      {viewer && shown && (
        <Lightbox
          items={shown.urls.map((url) => ({ url, w: shown.width, h: shown.height, kind: "image" as const }))}
          start={viewer.index}
          origin={viewer.el}
          originFor={(i) => slides.current[i] ?? null}
          onIndexChange={scrollTo}
          label={shown.urls.length > 1 ? "Final carousel" : "Final image"}
          onClose={() => setViewer(null)}
        />
      )}
    </div>
  );
}
