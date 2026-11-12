"use client";

import { memo, useDeferredValue, useMemo } from "react";
import { GraphicPreview, type GraphicPreviewProps, type PreviewAssets } from "@/lib/graphics/preview";
import { FORMATS, STYLES, STYLE_INFO, type FormatId, type Style, type TemplateId } from "@/lib/graphics/spec";
import { getPalette } from "@/lib/palettes";
import { PALETTE_CHOICES, assetsUrl, type GlassId, type PaletteChoice } from "@/lib/studio/create";
import { useWidth } from "../hooks";
import { useAssets } from "./useAssets";

// The instant preview: the graphic drawn by the browser from the same
// template components the server renders (lib/graphics/preview), so every
// keystroke, palette or style shows in the next frame. The palette strip
// and the style cards draw the same design small, once per choice.

/** Everything a preview depends on. */
export type Look = {
  template: TemplateId;
  format: FormatId;
  palette: PaletteChoice;
  style: Style;
  glass: GlassId;
  fields: Record<string, string>;
  shot: string | null;
};

function props(look: Look, assets: PreviewAssets | null, scale: number): GraphicPreviewProps {
  return {
    template: look.template,
    format: look.format,
    palette: look.palette,
    style: look.style,
    glass: look.glass,
    fields: look.fields,
    assets,
    shotUrl: look.shot,
    scale,
  };
}

/** The big preview, sized by its box (no layout shift: the box's ratio is set by CSS before anything draws). */
export function PreviewStage({ look, sticky, note }: { look: Look; sticky?: boolean; note?: string }) {
  const url = assetsUrl(look);
  const assets = useAssets(url);
  const [ref, width] = useWidth<HTMLDivElement>();
  const { width: fw, height: fh } = FORMATS[look.format];
  const waiting = !!url && !assets;
  return (
    <div className={`st-stage${sticky ? " st-stage-sticky" : ""}`}>
      <div ref={ref} className="st-stage-box" style={{ ["--ar" as string]: `${fw} / ${fh}` }} aria-label="Preview" role="img">
        {width > 0 && <GraphicPreview {...props(look, assets, width / fw)} />}
      </div>
      <div className="st-stage-meta">
        <span>{note ?? `${FORMATS[look.format].label} · ${fw}×${fh}`}</span>
        <span>{waiting ? (look.style === "glass" ? "Preparing the glass…" : "Reading colours…") : "Live preview"}</span>
      </div>
    </div>
  );
}

/** One small copy of the design (memoized: it redraws only when its own look changes). */
const Mini = memo(function Mini({ look, width }: { look: Look; width: number }) {
  const assets = useAssets(assetsUrl(look));
  const { width: fw, height: fh } = FORMATS[look.format];
  const scale = width / fw;
  return (
    <span className="st-swatch-box" style={{ width, height: Math.round(fh * scale) }}>
      <GraphicPreview {...props(look, assets, scale)} />
    </span>
  );
});

/** The same design in every palette (and auto); a tap picks one. Drawn at low priority so typing stays instant. */
export function PaletteStrip({ look, onPick }: { look: Look; onPick: (p: PaletteChoice) => void }) {
  const deferred = useDeferredValue(look);
  // One stable look per palette, so each small copy redraws only when the design does.
  const looks = useMemo(() => PALETTE_CHOICES.map((p) => ({ ...deferred, palette: p })), [deferred]);
  const width = FORMATS[look.format].width > FORMATS[look.format].height ? 104 : 70;
  return (
    <div className="st-strip" role="group" aria-label="Palette">
      {PALETTE_CHOICES.map((p, i) => {
        const palette = p === "auto" ? null : getPalette(p);
        return (
          <button key={p} type="button" className="st-swatch" aria-pressed={look.palette === p} onClick={() => onPick(p)} aria-label={palette ? palette.name : "Auto (from the screenshot)"}>
            <Mini look={looks[i]} width={width} />
            {palette ? (
              <span className="st-swatch-bar" aria-hidden="true">
                <span style={{ flex: 6, background: palette.base, boxShadow: "inset 0 0 0 1px rgb(0 0 0 / .08)" }} />
                <span style={{ flex: 3, background: palette.surface }} />
                <span style={{ flex: 1, background: palette.accent }} />
              </span>
            ) : (
              <span className="st-swatch-bar" aria-hidden="true" style={{ background: "linear-gradient(90deg, #0a0a0a, #0040ff, #f3efe6)" }} />
            )}
            <span>{palette ? palette.name : "Auto"}</span>
          </button>
        );
      })}
    </div>
  );
}

/** The five styles, each showing the current design in it. */
export function StylePicker({ look, onPick }: { look: Look; onPick: (s: Style) => void }) {
  const deferred = useDeferredValue(look);
  const looks = useMemo(() => STYLES.map((s) => ({ ...deferred, style: s })), [deferred]);
  const wide = FORMATS[look.format].width > FORMATS[look.format].height;
  return (
    <div className="st-styles" role="group" aria-label="Style">
      {STYLES.map((s, i) => (
        <button key={s} type="button" className="st-style-card" aria-pressed={look.style === s} onClick={() => onPick(s)} title={STYLE_INFO[s].description}>
          <span className="st-style-thumb">
            <Mini look={looks[i]} width={wide ? 118 : look.format === "story" ? 84 : 112} />
          </span>
          <span>{STYLE_INFO[s].label}</span>
        </button>
      ))}
    </div>
  );
}
