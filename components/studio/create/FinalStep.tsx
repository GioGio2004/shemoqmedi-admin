"use client";

import { useEffect, useState } from "react";

export type Rendered = { key: string; urls: string[]; width: number; height: number };

function Elapsed({ since }: { since: number }) {
  const [now, setNow] = useState(since);
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(t);
  }, []);
  return <span className="st-tnum">{((now - since) / 1000).toFixed(1)} s</span>;
}

/**
 * The server's exact JPEG(s): the preview is the browser's drawing, this is
 * what gets posted. Any change to the design afterwards marks it stale.
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
  const height = 220;
  const boxes = rendered && !rendering ? rendered.urls.length : slots;
  return (
    <div className="st-stack">
      <div className="st-finals" aria-live="polite" aria-busy={rendering !== null}>
        {Array.from({ length: boxes }, (_, i) => {
          const url = !rendering ? rendered?.urls[i] : undefined;
          const w = Math.round(height * (rendered && !rendering ? rendered.width / rendered.height : ratio));
          return url ? (
            <a key={url} href={url} target="_blank" rel="noopener noreferrer" style={{ width: w, height, opacity: stale ? 0.45 : 1 }} aria-label={`Final image ${i + 1}`}>
              <img src={url} alt="" />
              {boxes > 1 && <span className="st-final-index">{i + 1}</span>}
            </a>
          ) : (
            <span key={i} className={rendering ? "st-skel" : undefined} style={{ display: "block", flexShrink: 0, width: w, height, borderRadius: 8, border: rendering ? 0 : "1px dashed var(--st-line-strong)" }} />
          );
        })}
      </div>
      {rendering !== null && (
        <div className="st-stack" style={{ gap: 6 }}>
          <div className="st-progress" data-indeterminate="true">
            <span />
          </div>
          <p className="st-note">
            Rendering on the server… <Elapsed since={rendering} />
            {glass ? " · glass takes a few seconds" : ""}
          </p>
        </div>
      )}
      {stale && rendered && !rendering && <p className="st-callout" data-tone="blue">The design changed since this render. Render again to post what you see.</p>}
      <div className="st-actions">
        <button type="button" className={`st-btn ${rendered && !stale ? "st-btn-ghost" : ""}`} onClick={onRender} disabled={rendering !== null} data-busy={rendering !== null}>
          {rendered ? "Render again" : "Render final"}
        </button>
        {rendered && !stale && rendering === null && (
          <span className="st-note" style={{ alignSelf: "center" }}>
            {rendered.urls.length} image{rendered.urls.length === 1 ? "" : "s"} · {rendered.width}×{rendered.height} · JPEG
          </span>
        )}
      </div>
    </div>
  );
}
